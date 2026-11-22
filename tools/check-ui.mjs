// 界面自查：起一个临时数据目录的实例，用无头浏览器跑一遍导播台的关键操作，
// 截图与断言结果写到 dist/ui-review/。
//
// 用法：node tools/check-ui.mjs
// 需要本机有 Chrome / Chromium / Edge：默认按 CHROME_PATH、Playwright 缓存、系统安装顺序查找。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createApp } from '../server/server.js';
import { initialState } from '../server/state.js';
import { activeEvent } from '../public/sport.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'dist', 'ui-review');
await mkdir(artifacts, { recursive: true });

async function findBrowser() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  const cache = path.join(process.env.LOCALAPPDATA || process.env.HOME || '', 'ms-playwright');
  try {
    const builds = (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().reverse();
    for (const build of builds) candidates.push(path.join(cache, build, 'chrome-win64', 'chrome.exe'));
  } catch { /* 没有 Playwright 缓存时继续找系统安装的浏览器 */ }
  candidates.push(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  );
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* 换下一个 */ }
  }
  throw new Error('没有找到 Chrome / Chromium / Edge，请用 CHROME_PATH 指定可执行文件。');
}

const temporary = await mkdtemp(path.join(tmpdir(), 'yanzhou-ui-'));
const seed = initialState();
const race = activeEvent(seed);
race.competitors = ['林浩宇', '陈子航', '陆晨曦', '吴思远', '苏乐扬', '张铭轩', '周予安', '韩东辰'].map((name, index) => ({
  id: `seed-${index + 1}`, name, lane: index + 1, bib: String(101 + index), team: `${index + 1}班`, time: null, attempts: [], status: 'pending', heat: 1,
}));
race.competitors[0].time = 201520;
race.competitors[0].status = 'ok';
race.competitors[4].name = '阿卜杜拉甲';
await writeFile(path.join(temporary, 'settings.json'), JSON.stringify(seed));

const app = createApp({ dataDir: temporary });
const port = await app.listen(0);
const base = 'http://127.0.0.1:' + port;
const profile = await mkdtemp(path.join(tmpdir(), 'yanzhou-chromium-'));
const browserPath = await findBrowser();
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

let ws;
let browserError;
browser.on('error', error => { browserError = error; });
const errors = [];
const report = { base, dataDirectory: temporary, checks: [], screenshots: [] };
try {
  let debugPort;
  for (let tries = 0; tries < 150; tries++) {
    if (browserError) throw browserError;
    try { debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { /* 等浏览器启动 */ }
    await pause(100);
  }
  assert.ok(debugPort, 'headless browser starts');
  const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let serial = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.id) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request?.reject(new Error(JSON.stringify(message.error))); else request?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const screenshot = async name => {
    await pause(320);
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(path.join(artifacts, name), Buffer.from(shot.data, 'base64'));
    report.screenshots.push(name);
  };
  const until = async (expression, label) => {
    for (let tries = 0; tries < 100; tries++) {
      if (await evaluate(expression)) return;
      await pause(75);
    }
    console.log(JSON.stringify({ label, errors, dom: await evaluate('({text:document.body.innerText.slice(0,4000)})') }, null, 2));
    await screenshot('failure.png');
    throw new Error('Timeout: ' + label);
  };
  const type = (selector, value) => evaluate('(() => { const node = document.querySelector(' + JSON.stringify(selector) + '); node.focus(); node.value = ' + JSON.stringify(value) + '; node.dispatchEvent(new Event("input", {bubbles: true})); return true; })()');
  const submit = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').requestSubmit()');
  const click = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const viewport = (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await viewport(1920, 1080);
  await cdp('Page.navigate', { url: base + '/control.html' });
  await until('document.querySelector("#connection")?.classList.contains("connection--online") && document.querySelector("#rank-rows")?.textContent.includes("林浩宇")', 'control connected');

  assert.equal(await evaluate('document.querySelector("#quick-entry").hidden'), false, 'quick entry is inline and visible');
  assert.equal(await evaluate('document.querySelectorAll("#module-list .module-card").length'), 4, 'four layer cards');
  report.checks.push('Inline quick entry sits above the ranking table and the layer cards render in the output column.');

  // 1) 快速录入：号码 + 成绩，一步完成并自动进入下一位。
  await type('#qe-athlete', '102');
  await type('#qe-mark', '03:24.10');
  await submit('#quick-entry');
  await until('document.querySelector("#qe-status").classList.contains("is-ok") && document.querySelector("#rank-rows").textContent.includes("03:24.10")', 'quick entry saved');
  assert.equal(await evaluate('document.activeElement.id'), 'qe-athlete', 'focus returns to athlete field');
  assert.equal(await evaluate('document.querySelector("#qe-mark").value'), '', 'mark field cleared');
  report.checks.push('Quick entry saves a time by bib number, clears the mark and returns focus for the next athlete.');

  // 2) 行内编辑器：不弹窗即可改成绩。
  await click('[data-action="result-edit"]');
  await until('document.querySelector(".rank-editor .re-input") !== null', 'inline editor opened');
  await type('.rank-editor .re-input', '03:22.00');
  await submit('.rank-editor');
  await until('document.querySelector("#rank-rows").textContent.includes("03:22.00") && document.querySelector(".rank-editor") === null', 'inline editor saved');
  report.checks.push('Mark editing happens inline in the ranking row, with no dialog.');
  await screenshot('control-desktop.png');

  // 3) 切换男女组：除左上角 Logo 外的图层自动隐藏。
  await click('[data-action="division"][data-key="men"]');
  await until('document.querySelector("#layer-count").textContent.includes("上屏 1 / 4")', 'division switch hides layers');
  await pause(500);
  assert.equal(await evaluate('[...document.querySelector("#preview").contentDocument.querySelectorAll(".layer")].filter(node => !node.hidden).map(node => node.dataset.module).join()'), 'brand');
  assert.equal(await evaluate('document.querySelector(\'[data-action="module-toggle"][data-key="brand"]\').getAttribute("aria-pressed")'), 'true');
  report.checks.push('Switching to the other division hides every layer except the corner logo.');
  await click('[data-action="division"][data-key="women"]');
  await until('document.querySelector("#rank-rows").textContent.includes("林浩宇")', 'back to the seeded race');

  // 4) 图层开关：逐个上屏再下屏。
  await click('[data-action="module-toggle"][data-key="lineup"]');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".intro-name")?.textContent.length > 0', 'intro on air');
  await click('[data-action="module-toggle"][data-key="lineup"]');
  await until('document.querySelector("#preview").contentDocument?.querySelectorAll(".layer:not([hidden])").length === 2', 'intro off air');
  report.checks.push('Layer toggles put layers on air and take them off from the output column.');

  // 5) 尺寸自适应。
  await viewport(1366, 768);
  await screenshot('control-laptop.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(await evaluate('(() => { const box = document.querySelector(".save-status").getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })()'), true);
  report.checks.push('1366x768 keeps the save status on screen without horizontal scroll.');
  await viewport(1100, 800);
  await screenshot('control-tablet.png');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-nav")).display'), 'grid');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".preview-card")).display'), 'none');
  report.checks.push('1100px collapses into one column guarded by the workspace switch.');
  await viewport(390, 844);
  await screenshot('control-mobile-work.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await click('[data-action="workspace"][data-key="output"]');
  await screenshot('control-mobile-output.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  report.checks.push('390px stacks into one column and the workspace switch keeps both halves reachable.');

  // 6) 赛程与名单视图。
  await viewport(1920, 1080);
  await click('#open-schedule');
  await until('document.querySelector("#school-schedule").hidden === false && document.querySelectorAll(".schedule-row").length > 0', 'schedule view');
  await screenshot('control-schedule.png');
  await click('#open-roster');
  await until('document.querySelector("#competitors").hidden === false', 'roster view');
  await click('[data-action="athlete-add"]');
  await until('document.querySelector("#roster-form") !== null', 'inline athlete form');
  await type('#roster-form [name=name]', '\u5468\u5b50\u5b89');
  await type('#roster-form [name=bib]', '0110');
  await submit('#roster-form');
  await until('document.querySelector("#roster-summary").textContent.includes("9 位")', 'athlete added inline');
  report.checks.push('Adding an athlete happens inline in the roster pane.');
  await screenshot('control-roster.png');

  assert.deepEqual(errors, [], 'no uncaught browser exceptions');
  report.checks.push('No uncaught browser exceptions.');
  await writeFile(path.join(artifacts, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await cdp('Browser.close');
} finally {
  ws?.close();
  if (browser.exitCode === null) browser.kill();
  await app.close();
}
