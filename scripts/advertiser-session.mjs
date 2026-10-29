// Read-only, opt-in session bootstrap and diagnostic for Naver advertiser center.
// No password automation, CAPTCHA bypass, network interception, or ad clicks.
// Usage: node scripts/advertiser-session.mjs login|probe
import { chromium } from 'playwright';
import { mkdir, stat, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

const mode = process.argv[2];
if (!['login', 'probe'].includes(mode)) throw Error('Usage: node scripts/advertiser-session.mjs login|probe');
const sessionPath = resolve(process.env.NAVER_SESSION_FILE || homedir() + '/.config/olbarun/naver-advertiser-session.json');
const allowed = new Set(['ads.naver.com', 'searchad.naver.com']);
const startUrl = 'https://ads.naver.com/';
const browser = await chromium.launch({ headless: mode === 'probe' });
try {
  if (mode === 'login') {
    if (!process.stdin.isTTY) throw Error('Manual login requires an interactive terminal and desktop display');
    const context = await browser.newContext({ locale: 'ko-KR' });
    const page = await context.newPage();
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Complete login and any extra authentication in the opened browser. Do not share credentials.');
    console.log('After confirming the advertiser center is open, return here and press Enter.');
    process.stdin.resume();
    await new Promise(resolve => process.stdin.once('data', resolve));
    const url = new URL(page.url());
    if (url.protocol !== 'https:' || !allowed.has(url.hostname)) throw Error('Unexpected page; session not saved');
    // A session file is a bearer credential. Keep it outside the repository.
    await mkdir(dirname(sessionPath), { recursive: true, mode: 0o700 });
    await context.storageState({ path: sessionPath });
    await chmod(sessionPath, 0o600);
    console.log(JSON.stringify({ status: 'session_saved', file: sessionPath, note: 'Treat as secret; never commit or upload.' }));
    await context.close();
  } else {
    const info = await stat(sessionPath).catch(() => null);
    if (!info?.isFile()) throw Error('No session file; run manual login first');
    if ((info.mode & 0o077) !== 0) throw Error('Session file permissions too broad; require chmod 600');
    const context = await browser.newContext({ storageState: sessionPath, locale: 'ko-KR' });
    const page = await context.newPage();
    const response = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = new URL(page.url());
    const loginLikely = /login|nidlogin|auth|verify/i.test(url.hostname + url.pathname);
    const result = { mode: 'read-only', httpStatus: response?.status() ?? null,
      onAdvertiserDomain: allowed.has(url.hostname), reauthenticationRequired: loginLikely || !allowed.has(url.hostname),
      sessionReusable: !loginLikely && allowed.has(url.hostname) && response?.status() === 200,
      note: 'Navigation only; keyword preview selectors and region controls not yet verified.' };
    console.log(JSON.stringify(result, null, 2));
    if (!result.sessionReusable) process.exitCode = 2;
    await context.close();
  }
} finally { await browser.close(); }
