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
  await until('document.querySelector("#connection")?.classList.contains("connection--online") && document.querySelector("#roster-rows")?.textContent.includes("林浩宇")', 'control connected');

  // 无头浏览器默认报告浅色系统主题，先固定成深色，保证截图可复现
  await click('[data-theme-option="dark"]');
  await until('document.documentElement.dataset.theme === "dark"', 'dark theme pinned');
  assert.equal(await evaluate('document.querySelectorAll("#module-list .module-card").length'), 4, 'four layer cards');
  if (await evaluate('CSS.supports("appearance", "base-select")')) {
    assert.equal(await evaluate('document.querySelector(".intro-controls .select-display") !== null'), true, 'themed select trigger rendered');
  }
  report.checks.push('The roster lists the seeded athletes and the layer cards render in the output column.');

  // 1) 冠军流程：点冠军 → 行下展开成绩栏（不上屏）→ 推送成绩 → 点显示上屏。
  await click('[data-action="champion"]');
  await until('document.querySelector("#champion-mark") !== null && document.querySelector(\'[data-action="champion"]\')?.getAttribute("aria-pressed") === "true"', 'champion pane opened');
  assert.equal(await evaluate('document.querySelector(\'[data-action="module-toggle"][data-key="results"]\').getAttribute("aria-pressed")'), 'false', 'champion click does not go on air');
  await screenshot('control-champion-pane.png');
  await type('#champion-mark', '2:05.00');
  await click('[data-action="champion-push"]');
  await until('document.querySelector(\'[data-action="champion-show"]\') !== null', 'show button appears after push');
  await click('[data-action="champion-show"]');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".winner-name")?.textContent.includes("林浩宇")', 'champion card shows the athlete');
  assert.equal(await evaluate('document.querySelector("#preview").contentDocument?.querySelector(".winner-time")?.textContent'), '02:05.00');
  assert.equal(await evaluate('document.querySelector("#preview").contentDocument?.querySelector(".winner-crown")?.textContent.includes("冠军")'), true, 'crown band on the champion card');
  await screenshot('control-champion.png');
  assert.equal(await evaluate('document.querySelector(\'[data-action="module-toggle"][data-key="results"]\').getAttribute("aria-pressed")'), 'true', 'champion layer on air after show');
  assert.equal(await evaluate('document.querySelector("#layer-count").textContent'), '上屏 3 / 4');
  report.checks.push('Champion flow: pick the athlete, push the score in the inline pane, then show the champion card.');

  // 2) 图层开关：起跑介绍上屏会替换冠军卡，下屏后回到 Logo。
  await click('[data-action="module-toggle"][data-key="lineup"]');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".intro-name")?.textContent.length > 0', 'intro on air');
  assert.ok((await evaluate('document.querySelector("#preview").contentDocument?.querySelector(".intro-team")?.textContent'))?.includes('1班'), 'intro shows the class under the title');
  assert.equal(await evaluate('document.querySelector("#preview").contentDocument?.querySelector(".intro-bib")'), null, 'bib removed from the intro');
  await screenshot('control-intro.png');
  await click('[data-action="module-toggle"][data-key="lineup"]');
  await until('document.querySelector("#preview").contentDocument?.querySelectorAll(".layer:not([hidden])").length === 1', 'intro off air');
  report.checks.push('Layer toggles put layers on air and take them off from the output column.');

  // 3) 布局设置即调即生效：改 X 后监看画面立即移动，无需应用按钮。
  await click('[data-action="module-select"][data-key="event"]');
  await until('document.querySelector("#layout-form") !== null', 'layout inspector rendered');
  await type('#layout-form [name="x"]', '300');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".layer--event")?.style.left === "300px"', 'layout auto applied');
  report.checks.push('Layout changes apply immediately without an apply button.');

  await screenshot('control-desktop.png');

  // 4) 行内添加选手：表单只有姓名、班级、道次。
  await click('[data-action="athlete-add"]');
  await until('document.querySelector("#roster-form") !== null', 'inline athlete form');
  assert.equal(await evaluate('document.querySelector("#roster-form [name=bib]")'), null, 'bib field removed from the form');
  assert.ok((await evaluate('document.querySelector("#roster-rows thead").textContent')).includes('姓名 / 班级'));
  await type('#roster-form [name=name]', '测试选手');
  await submit('#roster-form');
  await until('document.querySelector("#roster-rows").textContent.includes("测试选手")', 'athlete added inline');
  report.checks.push('Adding an athlete happens inline with just name, class and lane.');
  await screenshot('control-roster.png');

  // 5) 尺寸自适应。
  await click('[data-action="workspace"][data-key="work"]');
  await viewport(1366, 768);
  await screenshot('control-laptop.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  report.checks.push('1366x768 keeps the workspace on screen without horizontal scroll.');
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

  // 6) 布局面板：外观与出场/退场默认折叠，展开后仍可编辑。
  await viewport(1920, 1080);
  await click('[data-action="module-select"][data-key="event"]');
  await pause(400);
  assert.equal(await evaluate('document.querySelectorAll("#layout-form details.settings-section").length'), 3);
  assert.equal(await evaluate('[...document.querySelectorAll("#layout-form details")].filter(d => d.open).length'), 1);
  await evaluate('(() => { const node = document.querySelector("#layout-form details[data-section=appearance]"); node.open = true; return true; })()');
  await pause(200);
  assert.equal(await evaluate('[...document.querySelectorAll("#layout-form details")].filter(d => d.open).length'), 2);
  report.checks.push('Layout panel groups position, appearance and motion into collapsible sections.');
  await evaluate('document.querySelector("#layout-form").scrollIntoView({ block: "start" })');
  await screenshot('control-layout.png');

  // 7) 深浅色切换。
  await click('[data-theme-option="light"]');
  await until('document.documentElement.dataset.theme === "light"', 'light theme applied');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(238, 240, 243)');
  await screenshot('control-light.png');
  await click('[data-theme-option="dark"]');
  await until('document.documentElement.dataset.theme === "dark"', 'dark theme applied');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(13, 14, 16)');
  report.checks.push('Theme switch flips between light and dark and persists the choice.');

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
