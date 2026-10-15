const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const cron = require('node-cron');
const path = require('path');
const db = require('./database');
const { runAllTrackers, enqueueTracker, scrapeIdentifierStatus, format28DigitEid, getLatestScreenshot, getAutomationStatus } = require('./worker');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================== PERSISTENT SQLITE SESSION STORE ======================

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired DATETIME NOT NULL
      )
    `);
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare("SELECT sess FROM user_sessions WHERE sid = ? AND expired > datetime('now')").get(sid);
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = (sess.cookie && sess.cookie.maxAge) ? sess.cookie.maxAge : 1000 * 60 * 60 * 24 * 30; // 30 days
      const expired = new Date(Date.now() + maxAge).toISOString();
      this.db.prepare("INSERT OR REPLACE INTO user_sessions (sid, sess, expired) VALUES (?, ?, ?)").run(sid, JSON.stringify(sess), expired);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare("DELETE FROM user_sessions WHERE sid = ?").run(sid);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(err);
    }
  }
}

// Body parsing and static files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session authentication with SQLite persistent storage (survives restarts)
app.use(
  session({
    store: new SQLiteSessionStore(db),
    secret: 'aadhaar_status_tracker_persistent_session_2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: false, // Set to true if running over HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days persistence
    }
  })
);

// Health check endpoints for Railway
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// Auth check middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

// ====================== AUTHENTICATION ROUTES ======================

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username and password (min 6 characters) required.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
    const result = stmt.run(username.trim(), passwordHash);
    
    req.session.userId = result.lastInsertRowid;
    req.session.username = username.trim();
    res.status(201).json({ message: 'User registered successfully.' });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Username is already taken.' });
    }
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Failed to register user.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ message: 'Login successful', username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out successfully.' });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, username: req.session.username });
});

// ====================== TRACKER ROUTES ======================

// Retrieve all trackers for current user
app.get('/api/trackers', requireAuth, (req, res) => {
  try {
    const trackers = db.prepare(`
      SELECT id, type, identifier_number, current_status, status_details, json_data, last_checked_at, created_at 
      FROM trackers 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).all(req.session.userId);

    res.json({ trackers });
  } catch (err) {
    console.error('Error fetching trackers:', err);
    res.status(500).json({ error: 'Failed to fetch trackers.' });
  }
});

// Retrieve details and execution history for a specific identifier
app.get('/api/trackers/:identifier/details', requireAuth, (req, res) => {
  try {
    const identifier = req.params.identifier.trim();
    // Look up tracker by identifier or ID
    const tracker = db.prepare(`
      SELECT * FROM trackers 
      WHERE (identifier_number = ? OR id = ?) AND user_id = ?
    `).get(identifier, identifier, req.session.userId);

    if (!tracker) {
      return res.status(404).json({ error: 'Tracker not found.' });
    }

    const history = db.prepare(`
      SELECT * FROM tracker_history 
      WHERE tracker_id = ? 
      ORDER BY checked_at DESC
    `).all(tracker.id);

    res.json({ tracker, history });
  } catch (err) {
    console.error('Error fetching tracker details:', err);
    res.status(500).json({ error: 'Failed to fetch tracker details.' });
  }
});

// Create a new tracker entry (duplicate check across all 3 pipeline sections)
app.post('/api/trackers', requireAuth, (req, res) => {
  let { type, identifier_number, date, time } = req.body;
  
  if (!['EID', 'SRN', 'URN', 'SID'].includes(type)) {
    return res.status(400).json({ error: 'Invalid tracking type. Must be EID, SRN, URN, or SID.' });
  }

  let cleanIdentifier = (identifier_number || '').trim();

  if (type === 'EID') {
    cleanIdentifier = format28DigitEid(cleanIdentifier, date, time);
    const digits = cleanIdentifier.replace(/\D/g, '');
    if (digits.length === 14) {
      return res.status(400).json({ 
        error: '14-digit Enrolment Number requires Date and Time to form the complete 28-digit EID.' 
      });
    }
    if (digits.length !== 28) {
      return res.status(400).json({ 
        error: `Invalid EID length (${digits.length} digits). EID must be 28 digits (14-digit Enrolment No + 14-digit Date/Time).` 
      });
    }
    cleanIdentifier = digits;
  }

  if (!cleanIdentifier) {
    return res.status(400).json({ error: 'Identifier number is required.' });
  }

  try {
    // Check if tracker already exists for this user across all 3 sections (Processing, Completed, Failed)
    const existing = db.prepare('SELECT id, type, identifier_number, current_status FROM trackers WHERE user_id = ? AND identifier_number = ?').get(req.session.userId, cleanIdentifier);
    if (existing) {
      let sectionLabel = 'In Progress';
      if (existing.current_status === 'Completed') sectionLabel = 'Completed';
      else if (existing.current_status === 'Failed') sectionLabel = 'Action Required / Failed';

      return res.status(400).json({ 
        error: `Duplicate Entry: "${existing.identifier_number}" is already active in your "${sectionLabel}" section. Duplicate entries are not allowed.` 
      });
    }

    const stmt = db.prepare(`
      INSERT INTO trackers (user_id, type, identifier_number, current_status, last_checked_at)
      VALUES (?, ?, ?, 'Processing', datetime('now'))
    `);
    
    const result = stmt.run(req.session.userId, type, cleanIdentifier);
    const newTracker = db.prepare('SELECT * FROM trackers WHERE id = ?').get(result.lastInsertRowid);

    // Queue tracker check safely
    enqueueTracker(newTracker);

    res.status(201).json({ message: 'Tracker created successfully.', tracker: newTracker });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: `This reference number (${cleanIdentifier}) is already being tracked in your pipeline.` });
    }
    console.error('Error creating tracker:', err);
    res.status(500).json({ error: 'Failed to create tracker.' });
  }
});

// Delete a tracker
app.delete('/api/trackers/:id', requireAuth, (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM trackers WHERE id = ? AND user_id = ?');
    const result = stmt.run(req.params.id, req.session.userId);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Tracker not found or unauthorized.' });
    }
    res.json({ message: 'Tracker deleted successfully.' });
  } catch (err) {
    console.error('Error deleting tracker:', err);
    res.status(500).json({ error: 'Failed to delete tracker.' });
  }
});

// Manual force re-check trigger for a tracker
app.post('/api/trackers/:id/check', requireAuth, (req, res) => {
  try {
    const tracker = db.prepare('SELECT * FROM trackers WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
    if (!tracker) {
      return res.status(404).json({ error: 'Tracker not found.' });
    }

    // Set to Processing & enqueue check safely
    db.prepare("UPDATE trackers SET current_status = 'Processing' WHERE id = ?").run(tracker.id);
    enqueueTracker(tracker);

    res.json({ message: 'Check queued successfully.' });
  } catch (err) {
    console.error('Error triggering check:', err);
    res.status(500).json({ error: 'Failed to initiate check.' });
  }
});

// ====================== PUBLIC ON-DEMAND SCRAPING API ======================

app.post('/api/v1/scrape', async (req, res) => {
  const identifier = (req.body.identifier || req.body.srn || req.body.number || req.body.eid || req.body.urn || '').trim();
  const type = req.body.type;
  const date = req.body.date;
  const time = req.body.time;

  if (!identifier) {
    return res.status(400).json({
      success: false,
      error: 'Identifier is required. Provide "identifier" (SRN, EID, URN, or SID) or "eid", "date", "time" in JSON body.'
    });
  }

  try {
    const result = await scrapeIdentifierStatus({ identifier, type, date, time });
    res.json(result);
  } catch (err) {
    console.error(`[API /api/v1/scrape Error] ${identifier}:`, err.message);
    res.status(500).json({
      success: false,
      identifier,
      error: err.message
    });
  }
});

app.get('/api/v1/scrape', async (req, res) => {
  const identifier = (req.query.identifier || req.query.srn || req.query.number || req.query.eid || req.query.urn || '').trim();
  const type = req.query.type;
  const date = req.query.date;
  const time = req.query.time;

  if (!identifier) {
    return res.status(400).json({
      success: false,
      error: 'Identifier is required in query parameter (e.g. /api/v1/scrape?identifier=S1318711695580 or /api/v1/scrape?eid=08672031600941&date=2026-10-14&time=16:22:56)'
    });
  }

  try {
    const result = await scrapeIdentifierStatus({ identifier, type, date, time });
    res.json(result);
  } catch (err) {
    console.error(`[API /api/v1/scrape Error] ${identifier}:`, err.message);
    res.status(500).json({
      success: false,
      identifier,
      error: err.message
    });
  }
});

// ====================== DEV DEBUG / LIVE STATUS ROUTES ======================

app.get('/api/debug/status', (req, res) => {
  res.json(getAutomationStatus());
});

app.get('/api/debug/screenshot', (req, res) => {
  const buffer = getLatestScreenshot();
  if (buffer) {
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.send(buffer);
  }

  // Return a dark placeholder SVG if no frame is captured yet
  const svgPlaceholder = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#0f172a"/>
      <circle cx="320" cy="160" r="28" fill="#1e293b"/>
      <text x="320" y="165" font-family="sans-serif" font-size="20" fill="#64748b" text-anchor="middle">📷</text>
      <text x="320" y="210" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">No Active Browser Stream</text>
      <text x="320" y="235" font-family="sans-serif" font-size="12" fill="#475569" text-anchor="middle">Trigger a check to stream live browser frames</text>
    </svg>
  `;
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(svgPlaceholder);
});

// ====================== BACKGROUND CRON SCHEDULER ======================

// Run exactly every 1 hour (at minute 0)
cron.schedule('0 * * * *', () => {
  console.log('[Cron] Triggering 1-hour recurring tracker status poll...');
  runAllTrackers().catch(err => console.error('[Cron Runner Error]', err.message));
});

// Serve interactive API docs for /api and /docs
app.get('/api', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api_docs.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'api_docs.html'));
});

// Serve tracker detail page for /:identifier (e.g. /S1331127444880)
app.get('/:identifier', (req, res, next) => {
  const id = req.params.identifier;
  // Ignore static assets and api endpoints
  if (id.includes('.') || id.startsWith('api') || id === 'favicon.ico') {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'tracker_detail.html'));
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(`🚀 Aadhaar Status Tracker is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`===================================================`);
});
