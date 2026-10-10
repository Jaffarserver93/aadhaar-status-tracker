const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'tracker.db'));

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

// Initialize database schemas
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trackers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT CHECK(type IN ('EID', 'SRN', 'URN', 'SID')) NOT NULL,
    identifier_number TEXT NOT NULL,
    current_status TEXT CHECK(current_status IN ('Processing', 'Completed', 'Failed')) DEFAULT 'Processing',
    status_details TEXT DEFAULT '',
    latest_screenshot TEXT DEFAULT '',
    last_checked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tracker_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    status_details TEXT DEFAULT '',
    screenshot_path TEXT DEFAULT '',
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tracker_id) REFERENCES trackers(id) ON DELETE CASCADE
  );
`);

// Auto-migrate column if existing table lacks latest_screenshot
try {
  db.exec("ALTER TABLE trackers ADD COLUMN latest_screenshot TEXT DEFAULT ''");
} catch (e) {
  // Column already exists
}

// Ensure unique constraint across user_id and identifier_number (prevent duplicates across all 3 sections)
try {
  db.exec(`
    DELETE FROM trackers 
    WHERE id NOT IN (
      SELECT MAX(id) FROM trackers GROUP BY user_id, identifier_number
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_tracker_identifier ON trackers(user_id, identifier_number);
  `);
} catch (e) {
  // Index created or handled
}

module.exports = db;
