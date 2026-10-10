const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const db = require('./database');

const EXTENSION_PATH = path.join(__dirname, 'extensions', 'blazcaptcha');
const PROFILES_ROOT = path.join(__dirname, 'browser_profiles');

// Ensure root browser profiles directory exists
if (!fs.existsSync(PROFILES_ROOT)) {
  fs.mkdirSync(PROFILES_ROOT, { recursive: true });
}

let latestScreenshotBuffer = null;
let latestAutomationStatus = { active: false, message: 'Idle', timestamp: Date.now() };

function getLatestScreenshot() {
  return latestScreenshotBuffer;
}

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

async function captureFrame(page) {
  try {
    if (page && !page.isClosed()) {
      latestScreenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 75 });
    }
  } catch (e) {
    // Ignore frame capture errors during navigation
  }
}

// ====================== CONCURRENCY TASK QUEUE ======================

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
    setTimeout(processNextQueuedTask, 1500);
  }
}

// ====================== AUTOMATION WORKER ======================

/**
 * Checks tracker status following the exact UIDAI Beta recording with BlazCaptcha,
 * automatic retries, screenshot capture, and status classification.
 * @param {Object} tracker
 */
async function checkTrackerStatus(tracker) {
  let context = null;
  let page = null;
  let frameInterval = null;
  
  const jobProfileDir = path.join(PROFILES_ROOT, `profile_${tracker.id}_${Date.now()}_${Math.random().toString(36).substring(7)}`);

  try {
    const identifier = (tracker.identifier_number || '').trim();
    let trackerType = (tracker.type || 'EID').toUpperCase();

    // Auto-detect type
    if (identifier.toUpperCase().startsWith('S')) {
      trackerType = identifier.length > 20 ? 'SID' : 'SRN';
    } else if (/^\d{8}$/.test(identifier)) {
      trackerType = 'URN';
    } else if (/^\d{14}$|^\d{28}$/.test(identifier.replace(/[\/\s-]/g, ''))) {
      trackerType = 'EID';
    }

    try {
      db.prepare('UPDATE trackers SET type = ? WHERE id = ?').run(trackerType, tracker.id);
    } catch (e) {}

    updateLog(`Launching browser for ${trackerType}: ${identifier}...`, true);

    context = await chromium.launchPersistentContext(jobProfileDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--no-proxy-server',
        '--window-size=1280,720'
      ],
      viewport: { width: 1280, height: 720 },
      locale: 'en-US'
    });

    const pages = context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.bringToFront();

    // Start 1-second live screenshot streaming
    frameInterval = setInterval(() => {
      captureFrame(page);
    }, 1000);

    // 1. Multi-domain navigation with fast fallback
    let navSuccess = false;
    const targetUrls = [
      'https://myaadhaarbeta.uidai.gov.in/CheckAadhaarStatus/en',
      'https://myaadhaarbeta.uidai.gov.in/',
      'https://myaadhaar.uidai.gov.in/en_IN'
    ];

    for (const url of targetUrls) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          updateLog(`Connecting to ${url} (Attempt ${attempt})...`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          navSuccess = true;
          break;
        } catch (err) {
          console.warn(`[Worker] Connection to ${url} (Attempt ${attempt}) failed: ${err.message}`);
          await page.waitForTimeout(1000);
        }
      }
      if (navSuccess) break;
    }

    if (!navSuccess) {
      throw new Error('Unable to reach UIDAI portal. Please verify network connectivity.');
    }

    await page.waitForTimeout(2500);
    await captureFrame(page);

    // If landed on homepage, click Check Status card (from DevTools recording)
    if (!page.url().includes('CheckAadhaarStatus')) {
      updateLog('Clicking "Check Enrolment / Update Status" card...');
      const card = page.locator('div.CQICdXLXE7_kGaqK_DFw div.ObNM8EihY9gOy0T0u4Ya svg, div:has-text("Check Enrolment / Update Status")').first();
      if (await card.count() > 0) {
        await card.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    // 2. Section handling (EID = Section 0, SRN = Section 1, URN = Section 2, SID = Section 3)
    let sectionIndex = 0;
    if (trackerType === 'SRN') sectionIndex = 1;
    else if (trackerType === 'URN') sectionIndex = 2;
    else if (trackerType === 'SID') sectionIndex = 3;

    updateLog(`Opening ${trackerType} Section (#faq-header-${sectionIndex})...`);

    // If Section 0 is currently expanded and we need another section, collapse it as in recording
    if (sectionIndex !== 0) {
      const sec0Panel = page.locator('#faq-panel-0');
      if (await sec0Panel.isVisible().catch(() => false)) {
        const sec0Arrow = page.locator('#faq-header-0 svg, #faq-header-0').first();
        if (await sec0Arrow.count() > 0) {
          await sec0Arrow.click({ force: true }).catch(() => {});
          await page.waitForTimeout(600);
        }
      }

      // Expand target section
      const secHeader = page.locator(`#faq-header-${sectionIndex}`).first();
      await secHeader.click({ force: true }).catch(async () => {
        await secHeader.evaluate(el => el.click()).catch(() => {});
      });
      await page.waitForTimeout(1500);
    }

    const panelSelector = `#faq-panel-${sectionIndex}`;
    await page.locator(panelSelector).waitFor({ state: 'visible', timeout: 10000 });
    await captureFrame(page);

    // 3. Fill identifier into correct text field
    updateLog(`Entering ${trackerType}: ${identifier}...`);
    let inputField;
    if (sectionIndex === 1) {
      // SRN Input from recording: div.BiaAUuVJJdzMsIzgwfHz input or placeholder SXXXXXXXXXXXXX
      inputField = page.locator(`${panelSelector} input[placeholder*="SXXXX" i], ${panelSelector} div.BiaAUuVJJdzMsIzgwfHz input, ${panelSelector} input[name="srnField"]`).first();
    } else if (sectionIndex === 2) {
      inputField = page.locator(`${panelSelector} input[placeholder*="URN" i], ${panelSelector} input[name="urnField"], ${panelSelector} input[type="text"]:not([name="captcha"])`).first();
    } else if (sectionIndex === 3) {
      inputField = page.locator(`${panelSelector} input[placeholder*="SID" i], ${panelSelector} input[name="sidField"], ${panelSelector} input[type="text"]:not([name="captcha"])`).first();
    } else {
      inputField = page.locator(`${panelSelector} input[type="text"]:not([name="captcha"]), ${panelSelector} input[name="enrolmentNumber"]`).first();
    }

    await inputField.waitFor({ state: 'visible', timeout: 10000 });
    await inputField.fill('');
    await inputField.fill(identifier);
    await inputField.dispatchEvent('input');
    await inputField.dispatchEvent('change');
    await page.waitForTimeout(600);
    await captureFrame(page);

    // 4. Captcha Solve & Submission Loop (with automatic retry)
    const MAX_CAPTCHA_RETRIES = 4;
    let detectedStatus = 'Processing';
    let statusDetails = 'Under verification';

    for (let attempt = 1; attempt <= MAX_CAPTCHA_RETRIES; attempt++) {
      if (attempt > 1) {
        updateLog(`[Retry ${attempt}/${MAX_CAPTCHA_RETRIES}] Invalid CAPTCHA prompt. Refreshing & retrying...`);
        
        // Dismiss any modal/popup
        const closeBtn = page.locator('button:has-text("✕"), button:has-text("×"), svg[class*="close"], .modal button, [aria-label*="close" i]').first();
        if (await closeBtn.count() > 0 && await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(800);
        }

        // Click refresh captcha icon
        const refreshBtn = page.locator(`${panelSelector} svg[class*="refresh"], ${panelSelector} button[aria-label*="refresh" i], ${panelSelector} img[alt*="refresh" i]`).first();
        if (await refreshBtn.count() > 0) {
          await refreshBtn.click({ force: true }).catch(() => {});
          await page.waitForTimeout(1500);
        }
      }

      // Clear Captcha input (recording: div.sppgA5LMyS7vwKlefQiw input or placeholder "Type characters")
      const captchaInput = page.locator(`${panelSelector} input[placeholder*="characters" i], ${panelSelector} div.sppgA5LMyS7vwKlefQiw input, ${panelSelector} input[name="captcha"]`).first();
      await captchaInput.fill('');
      await page.waitForTimeout(400);

      // Trigger BlazCaptcha solver inside Shadow DOM
      updateLog(`[Attempt ${attempt}] Triggering BlazCaptcha solver in ${panelSelector}...`);
      await page.evaluate((selector) => {
        const panel = document.querySelector(selector);
        if (!panel) return false;
        const host = panel.querySelector('span.captcha-solver-host');
        if (host && host.shadowRoot) {
          const btn = host.shadowRoot.querySelector('button.captcha-btn');
          if (btn) {
            btn.click();
            return true;
          }
        }
        return false;
      }, panelSelector);

      // Wait for captcha recognition
      let solvedCaptcha = '';
      for (let s = 1; s <= 12; s++) {
        await page.waitForTimeout(1000);
        const val = await captchaInput.inputValue().catch(() => '');
        if (val && val.length >= 4) {
          solvedCaptcha = val;
          updateLog(`BlazCaptcha recognized: "${solvedCaptcha}" (Attempt ${attempt})`);
          break;
        }
      }
      await captureFrame(page);

      // Dispatch React native input event to ensure form state enables submit
      if (solvedCaptcha) {
        await page.evaluate((selector) => {
          const panel = document.querySelector(selector);
          const input = panel ? panel.querySelector('input[placeholder*="characters" i], input[name="captcha"]') : null;
          if (input && input.value) {
            const lastValue = input.value;
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(input, lastValue);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, panelSelector);
        await page.waitForTimeout(500);
      }

      // Click "Check Status" button (recording: div.RgAFI1DLFI2GLrXbsEsO button or #faq-panel-1 button:has-text("Check Status"))
      updateLog('Submitting Status Query...');
      const submitBtn = page.locator(`${panelSelector} button:has-text("Check Status"), ${panelSelector} div.RgAFI1DLFI2GLrXbsEsO button, ${panelSelector} button[type="submit"]`).first();
      try {
        await submitBtn.click({ timeout: 5000 });
      } catch {
        await submitBtn.evaluate(b => b.click()).catch(() => {});
      }

      await page.waitForTimeout(5000);
      await captureFrame(page);

      // Inspect DOM Response
      const pageText = await page.textContent('body');

      // 1. Invalid Captcha
      if (/invalid\s*captcha|entered an invalid captcha|correct captcha to proceed/i.test(pageText)) {
        console.log(`[Worker] Attempt ${attempt}: Invalid CAPTCHA prompt encountered.`);
        if (attempt < MAX_CAPTCHA_RETRIES) {
          continue; // Retry loop
        } else {
          detectedStatus = 'Failed';
          statusDetails = 'Captcha validation failed after multiple retries. Action required.';
          break;
        }
      }

      // 2. Invalid SRN / URN (ASC_VAL_SSA_INF_302) -> Mark Action Required / Failed
      if (/invalid\s*URN\/SRN|invalid\s*SRN|ASC_VAL_SSA_INF|Please enter the correct data to proceed/i.test(pageText)) {
        detectedStatus = 'Failed';
        statusDetails = 'Invalid SRN: You have entered an invalid URN/SRN. Please enter the correct data to proceed. (ASC_VAL_SSA_INF_302)';
        break;
      }

      // 3. Completed
      if (/your aadhaar has been updated|has been updated|completed successfully|aadhaar generated|dispatched|delivered/i.test(pageText)) {
        detectedStatus = 'Completed';
        statusDetails = 'Your Aadhaar has been updated.';
        break;
      }

      // 4. In Progress (Quality Check)
      if (/quality check of your submitted documents|doing a quality check|your update request is in progress|under process|in progress|under verification/i.test(pageText)) {
        detectedStatus = 'Processing';
        statusDetails = "We're currently doing a quality check of your submitted documents. Please log in after a few days to view the latest status updates.";
        break;
      }

      // 5. Rejection / Other Failure
      if (/rejected|cancelled|invalid reference|does not exist|failed/i.test(pageText)) {
        detectedStatus = 'Failed';
        statusDetails = 'Verification failed or request rejected by portal. Action required.';
        break;
      }

      detectedStatus = 'Processing';
      statusDetails = 'Request is currently being processed by UIDAI.';
      break;
    }

    // 5. Save Result Screenshot & Update SQLite record
    let screenshotUrl = '';
    try {
      const screenshotFilename = `shot_${tracker.id}_${Date.now()}.jpg`;
      const screenshotDiskPath = path.join(__dirname, 'public', 'screenshots', screenshotFilename);
      const finalShotBuffer = await page.screenshot({ type: 'jpeg', quality: 85 });
      fs.writeFileSync(screenshotDiskPath, finalShotBuffer);
      screenshotUrl = `/screenshots/${screenshotFilename}`;
    } catch (shotErr) {
      console.error('[Worker] Failed to capture final disk screenshot:', shotErr.message);
    }

    // Insert history record
    try {
      db.prepare(`
        INSERT INTO tracker_history (tracker_id, status, status_details, screenshot_path, checked_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(tracker.id, detectedStatus, statusDetails, screenshotUrl);
    } catch (histErr) {
      console.error('[Worker] Failed to insert tracker history:', histErr.message);
    }

    // Update main tracker record
    const updateStmt = db.prepare(`
      UPDATE trackers 
      SET current_status = ?, status_details = ?, latest_screenshot = ?, last_checked_at = datetime('now')
      WHERE id = ?
    `);
    updateStmt.run(detectedStatus, statusDetails, screenshotUrl, tracker.id);

    updateLog(`Finished #${tracker.id}: Status -> ${detectedStatus} ("${statusDetails}")`, false);
    await captureFrame(page);

  } catch (error) {
    updateLog(`Error checking #${tracker.id}: ${error.message}`, false);

    try {
      const errorStmt = db.prepare(`
        UPDATE trackers 
        SET current_status = 'Failed', status_details = ?, last_checked_at = datetime('now')
        WHERE id = ?
      `);
      errorStmt.run(`Automation note: ${error.message}`, tracker.id);
    } catch (dbErr) {
      console.error('[Worker] DB update error:', dbErr.message);
    }

  } finally {
    if (frameInterval) clearInterval(frameInterval);
    if (context) await context.close().catch(() => {});
    
    // Clean up temporary profile directory
    try {
      if (fs.existsSync(jobProfileDir)) {
        fs.rmSync(jobProfileDir, { recursive: true, force: true });
      }
    } catch (e) {
      // Ignore cleanup lock
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
    `).all();

    console.log(`[Worker] Found ${trackers.length} pending tracker(s) to check.`);
    for (const tracker of trackers) {
      enqueueTracker(tracker);
    }
  } catch (err) {
    console.error('[Worker] Cron error:', err.message);
  }
}

module.exports = {
  runAllTrackers,
  enqueueTracker,
  checkTrackerStatus,
  getLatestScreenshot,
  getAutomationStatus
};
