const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { randomUUID } = require('crypto');
const db = require('./database');

const EXTENSION_PATH = path.join(__dirname, 'extensions', 'blazcaptcha');
const PROFILES_ROOT = path.join(__dirname, 'browser_profiles');

if (!fs.existsSync(PROFILES_ROOT)) {
  fs.mkdirSync(PROFILES_ROOT, { recursive: true });
}

let latestAutomationStatus = { active: false, message: 'Idle', timestamp: Date.now() };

function getAutomationStatus() {
  return latestAutomationStatus;
}

function updateLog(message, active = true) {
  latestAutomationStatus = {
    active,
    message,
    timestamp: Date.now()
  };
  console.log(`[Worker Live] ${message}`);
}

// Dummy for backwards-compatibility with live screenshot endpoint
function getLatestScreenshot() {
  return null;
}

// ====================== EXTENSION OCR SOLVER INSTANCE ======================

let ocrBrowserContext = null;
let ocrPage = null;

async function getOcrPage() {
  if (ocrPage && !ocrPage.isClosed()) {
    return ocrPage;
  }

  const ocrProfileDir = path.join(PROFILES_ROOT, 'ocr_engine');
  if (!fs.existsSync(ocrProfileDir)) {
    fs.mkdirSync(ocrProfileDir, { recursive: true });
  }

  ocrBrowserContext = await chromium.launchPersistentContext(ocrProfileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-proxy-server',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ],
    viewport: { width: 400, height: 300 }
  });

  let worker = ocrBrowserContext.serviceWorkers()[0];
  if (!worker) {
    worker = await ocrBrowserContext.waitForEvent('serviceworker', { timeout: 15000 });
  }
  const extensionId = worker.url().split('/')[2];

  ocrPage = await ocrBrowserContext.newPage();
  await ocrPage.goto(`chrome-extension://${extensionId}/offscreen.html`);
  await ocrPage.waitForTimeout(1000);
  return ocrPage;
}

async function solveCaptchaWithExtension(imageBase64) {
  const page = await getOcrPage();
  const cleanBase64 = imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}`;
  
  const res = await page.evaluate(async (img) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'OCR_REQUEST',
        imageData: img
      }, (resp) => {
        resolve(resp);
      });
    });
  }, cleanBase64);

  return res && res.text ? res.text.trim() : null;
}

// ====================== DIRECT TATHYA REST API CALLS ======================

function fetchTathyaCaptcha() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'tathya.uidai.gov.in',
      port: 443,
      path: '/unifiedAppAuthService/api/generic/generateCaptcha',
      method: 'GET',
      headers: {
        'x-request-id': randomUUID(),
        'referer': 'https://myaadhaarbeta.uidai.gov.in/',
        'origin': 'https://myaadhaarbeta.uidai.gov.in',
        'accept': 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function submitTathyaStatusCheck(identifier, captchaValue, transactionId, trackerType) {
  return new Promise((resolve, reject) => {
    const payload = {
      captchaValue,
      captchaTxnId: transactionId
    };

    if (trackerType === 'URN') payload.urn = identifier;
    else if (trackerType === 'EID') payload.eid = identifier;
    else if (trackerType === 'SID') payload.sid = identifier;
    else payload.srn = identifier;

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'tathya.uidai.gov.in',
      port: 443,
      path: '/statusCheckService/api/generic/aadhaar-request-status',
      method: 'POST',
      headers: {
        'x-request-id': randomUUID(),
        'appid': 'MYAADHAARREVAMP',
        'x-request-timestamp': Date.now().toString(),
        'referer': 'https://myaadhaarbeta.uidai.gov.in/',
        'origin': 'https://myaadhaarbeta.uidai.gov.in',
        'accept-language': 'en_in',
        'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve({ raw: d });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ====================== CORE API SCRAPER FUNCTION ======================

/**
 * Scrapes status directly via Tathya API with instant BlazCaptcha OCR solver
 * @param {Object} params { identifier, type }
 * @returns {Promise<Object>} Formatted status result with raw json_data
 */
async function scrapeIdentifierStatus({ identifier, type }) {
  const cleanId = (identifier || '').trim();
  let trackerType = (type || 'EID').toUpperCase();

  // Auto-detect type
  if (cleanId.toUpperCase().startsWith('S')) {
    trackerType = cleanId.length > 20 ? 'SID' : 'SRN';
  } else if (/^\d{8}$/.test(cleanId)) {
    trackerType = 'URN';
  } else if (/^\d{14}$|^\d{28}$/.test(cleanId.replace(/[\/\s-]/g, ''))) {
    trackerType = 'EID';
  }

  const startTime = Date.now();
  const MAX_RETRIES = 5;
  let finalApiResult = null;
  let detectedStatus = 'Processing';
  let statusDetails = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    updateLog(`[API Scraper] Attempt ${attempt}: Fetching captcha for ${trackerType} ${cleanId}...`, true);
    const captcha = await fetchTathyaCaptcha();

    if (!captcha || !captcha.imageBase64) {
      await new Promise(r => setTimeout(r, 600));
      continue;
    }

    const solvedText = await solveCaptchaWithExtension(captcha.imageBase64);
    if (!solvedText || solvedText.length < 4) {
      continue;
    }

    updateLog(`[API Scraper] Solved Captcha: "${solvedText}". Querying Tathya Status API...`, true);
    const apiRes = await submitTathyaStatusCheck(cleanId, solvedText, captcha.transactionId, trackerType);

    // If Captcha failed, instantly retry with new captcha
    if (apiRes && apiRes.errorCode === 'ASC_VAL_CAP_INF_001') {
      updateLog(`[API Scraper] Captcha rejected, retrying instantly...`, true);
      continue;
    }

    finalApiResult = apiRes;
    break;
  }

  if (!finalApiResult) {
    throw new Error('Unable to solve captcha or obtain status from UIDAI after multiple retries.');
  }

  // Parse statusData or errors
  if (finalApiResult.statusData && Array.isArray(finalApiResult.statusData) && finalApiResult.statusData.length > 0) {
    const item = finalApiResult.statusData[0];
    statusDetails = item.resMessage || item.resMessageLocal || 'Status retrieved successfully';
    const code = (item.resMessageCode || '').toUpperCase();

    if (code.includes('GENERATED') || code.includes('PRINT') || /updated|completed/i.test(statusDetails)) {
      detectedStatus = 'Completed';
    } else if (/rejected|cancelled/i.test(statusDetails)) {
      detectedStatus = 'Failed';
    } else {
      detectedStatus = 'Processing';
    }
  } else if (finalApiResult.errorCode) {
    detectedStatus = 'Failed';
    statusDetails = (finalApiResult.errorDetails && finalApiResult.errorDetails.messageEnglish)
      ? finalApiResult.errorDetails.messageEnglish
      : `Error: ${finalApiResult.errorCode}`;
  } else {
    detectedStatus = 'Processing';
    statusDetails = 'Request received and being processed by UIDAI';
  }

  updateLog(`[API Scraper] Completed ${cleanId}: Status -> ${detectedStatus}`, false);

  return {
    success: detectedStatus !== 'Failed' || !finalApiResult.errorCode,
    identifier: cleanId,
    type: trackerType,
    status: detectedStatus,
    status_details: statusDetails,
    json_data: finalApiResult,
    execution_time_ms: Date.now() - startTime,
    scraped_at: new Date().toISOString()
  };
}

// ====================== CONCURRENCY QUEUE & WORKER ======================

const taskQueue = [];
let isWorkerRunning = false;

function enqueueTracker(tracker) {
  if (!tracker || !tracker.id) return;
  if (!taskQueue.some(t => t.id === tracker.id)) {
    taskQueue.push(tracker);
    console.log(`[Queue] Enqueued tracker #${tracker.id} (${tracker.type}: ${tracker.identifier_number}). Queue size: ${taskQueue.length}`);
  }
  processNextQueuedTask();
}

async function processNextQueuedTask() {
  if (isWorkerRunning || taskQueue.length === 0) return;
  isWorkerRunning = true;

  const currentTracker = taskQueue.shift();
  try {
    await checkTrackerStatus(currentTracker);
  } catch (err) {
    console.error(`[Queue Error] Tracker #${currentTracker.id}:`, err.message);
  } finally {
    isWorkerRunning = false;
    setTimeout(processNextQueuedTask, 800);
  }
}

/**
 * Checks tracker status via direct API and saves JSON response into SQLite
 * @param {Object} tracker
 */
async function checkTrackerStatus(tracker) {
  try {
    const result = await scrapeIdentifierStatus({
      identifier: tracker.identifier_number,
      type: tracker.type
    });

    const jsonString = JSON.stringify(result.json_data || {});

    // Insert history record
    try {
      db.prepare(`
        INSERT INTO tracker_history (tracker_id, status, status_details, json_data, checked_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(tracker.id, result.status, result.status_details, jsonString);
    } catch (histErr) {
      console.error('[Worker] Failed to insert tracker history:', histErr.message);
    }

    // Update main tracker record
    const updateStmt = db.prepare(`
      UPDATE trackers 
      SET type = ?, current_status = ?, status_details = ?, json_data = ?, last_checked_at = datetime('now')
      WHERE id = ?
    `);
    updateStmt.run(result.type, result.status, result.status_details, jsonString, tracker.id);

  } catch (error) {
    updateLog(`Error checking #${tracker.id}: ${error.message}`, false);

    const errJson = JSON.stringify({ error: error.message });
    try {
      db.prepare(`
        UPDATE trackers 
        SET current_status = 'Failed', status_details = ?, json_data = ?, last_checked_at = datetime('now')
        WHERE id = ?
      `).run(`Automation note: ${error.message}`, errJson, tracker.id);
    } catch (dbErr) {
      console.error('[Worker] DB update error:', dbErr.message);
    }
  }
}

/**
 * Batch cycle for recurring node-cron (checks only pending / processing trackers).
 */
async function runAllTrackers() {
  console.log('[Worker] Starting scheduled 1-hour cron run for pending trackers...');
  try {
    const trackers = db.prepare(`
      SELECT * FROM trackers 
      WHERE current_status = 'Processing'
      ORDER BY last_checked_at ASC
    `).all();

    console.log(`[Worker] Found ${trackers.length} pending tracker(s) to verify.`);
    for (const tracker of trackers) {
      enqueueTracker(tracker);
    }
  } catch (err) {
    console.error('[Worker Cron Error]', err.message);
  }
}

module.exports = {
  scrapeIdentifierStatus,
  checkTrackerStatus,
  runAllTrackers,
  enqueueTracker,
  getLatestScreenshot,
  getAutomationStatus
};
