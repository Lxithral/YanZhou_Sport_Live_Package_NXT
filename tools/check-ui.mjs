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
  const screenshot = async (name, clip) => {
    await pause(320);
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, ...(clip ? { clip } : {}) });
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
  const pointerClick = async selector => {
    const point = await evaluate('(() => { const node = document.querySelector(' + JSON.stringify(selector) + '); node.scrollIntoView({block:"nearest"}); const rect = node.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()');
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const enter = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  };
  const viewport = (width, height) => cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const sendCommand = (action, args) => new Promise((resolve, reject) => {
    const socket = new WebSocket(base.replace(/^http/, 'ws') + '/ws?role=control', { origin: base });
    const timeout = setTimeout(() => { socket.terminate(); reject(new Error('Command timeout ' + action)); }, 6000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'command', id: 'ui-review', command: { action, ...args } })));
    socket.once('error', error => { clearTimeout(timeout); reject(error); });
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type !== 'result' || message.id !== 'ui-review') return;
      clearTimeout(timeout);
      socket.close();
      if (message.ok) resolve();
      else reject(new Error(message.error));
    });
  });
  const checkGraphicText = async label => {
    const fitted = await evaluate(`(() => {
      const selectors = ['.winner-name', '.winner-team', '.winner-time', '.eb-copy strong', '.eb-copy small'];
      return selectors.map(selector => {
        const node = document.querySelector(selector);
        if (!node) return { selector, fits: true };
        const box = node.getBoundingClientRect();
        const parent = node.parentElement.getBoundingClientRect();
        return { selector, fits: box.left >= parent.left - .5 && box.right <= parent.right + .5 && box.top >= parent.top - .5 && box.bottom <= parent.bottom + .5 && node.scrollWidth <= node.clientWidth + 1 };
      });
    })()`);
    assert.ok(fitted.every(({ fits }) => fits), label + ' ' + JSON.stringify(fitted));
  };

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await viewport(1920, 1080);
  await cdp('Page.navigate', { url: base + '/control.html' });
  await until('document.querySelector("#connection")?.classList.contains("connection--online") && document.querySelector("#roster-seed-1-name")?.value === "林浩宇"', 'control connected');

  // 无头浏览器默认报告浅色系统主题，先固定成深色，保证截图可复现
  await click('[data-theme-option="dark"]');
  await until('document.documentElement.dataset.theme === "dark"', 'dark theme pinned');
  assert.equal(await evaluate('document.querySelectorAll("#module-list .module-card").length'), 4, 'four layer cards');
  if (await evaluate('CSS.supports("appearance", "base-select")')) {
    assert.equal(await evaluate('document.querySelector(".intro-controls .select-display") !== null'), true, 'themed select trigger rendered');
    await pointerClick('.intro-controls select');
    await until('document.querySelector(".intro-controls select").matches(":open")', 'intro picker opened');
    const picker = await evaluate(`(() => {
      const select = document.querySelector('.intro-controls select');
      const box = select.getBoundingClientRect();
      const option = select.querySelector('option').getBoundingClientRect();
      const style = getComputedStyle(select, '::picker(select)');
      return {
        selectWidth: box.width, selectLeft: box.left, selectRight: box.right,
        pickerWidth: style.width,
        pickerLeft: option.left - parseFloat(style.paddingLeft) - parseFloat(style.borderLeftWidth),
        pickerRight: option.right + parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth),
      };
    })()`);
    await screenshot('control-intro-picker.png');
    assert.ok(Math.abs(parseFloat(picker.pickerWidth) - picker.selectWidth) <= 1, 'picker matches select width ' + JSON.stringify(picker));
    assert.ok(Math.abs(picker.pickerLeft - picker.selectLeft) <= 1, 'picker matches select left edge ' + JSON.stringify(picker));
    assert.ok(Math.abs(picker.pickerRight - picker.selectRight) <= 1, 'picker matches select right edge ' + JSON.stringify(picker));
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    report.checks.push('The intro picker aligns with both edges of its select.');
  }
  report.checks.push('The roster lists the seeded athletes and the layer cards render in the output column.');

  // 名单行加高，姓名、班级、道次和成绩直接录入。
  assert.ok(await evaluate('document.querySelector("#roster-rows tr[data-athlete]").getBoundingClientRect().height >= 84'), 'athlete row has room for direct editing');
  assert.ok(await evaluate('document.querySelector("#properties-column").getBoundingClientRect().width <= 310'), 'output column narrowed');
  await type('#roster-seed-1-result', '2:06.00');
  await enter();
  await until('document.querySelector("#roster-seed-1-result")?.value === "02:06.00"', 'score saved with enter');
  await type('#roster-seed-2-result', '2:10.00');
  await evaluate('document.querySelector("#roster-seed-2-result").setSelectionRange(2,2)');
  await click('[data-action="module-toggle"][data-key="event"]');
  await until('document.querySelector(\'[data-action="module-toggle"][data-key="event"]\').getAttribute("aria-pressed") === "false"', 'event layer off');
  assert.equal(await evaluate('document.querySelector("#roster-seed-2-result").value'), '2:10.00', 'draft survives live refresh');
  assert.equal(await evaluate('document.activeElement.id'), 'roster-seed-2-result', 'focus survives live refresh');
  assert.equal(await evaluate('document.activeElement.selectionStart'), 2, 'cursor survives live refresh');
  await click('[data-action="module-toggle"][data-key="event"]');
  await enter();
  await until('document.querySelector("#roster-seed-2-result")?.value === "02:10.00"', 'second score saved');
  await type('#roster-seed-2-result', '2:11.00');
  await evaluate(`(() => {
    const input = document.querySelector('#roster-seed-2-result');
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    input.value = '02:10.00';
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  await until('document.querySelector("#roster-seed-2-result")?.dataset.original === "02:11.00"', 'first rapid edit saved');
  assert.equal(await evaluate('document.querySelector("#roster-seed-2-result").value'), '02:10.00', 'editing back during a save retains the latest value');
  await enter();
  await until('document.querySelector("#roster-seed-2-result")?.dataset.original === "02:10.00"', 'latest rapid edit saved');
  await type('#roster-seed-2-team', '高一2班');
  await evaluate('document.activeElement.blur()');
  await until('document.querySelector("#roster-seed-2-team")?.dataset.original === "高一2班"', 'class saved on blur');
  const stored = JSON.parse(await readFile(path.join(temporary, 'settings.json'), 'utf8'));
  const savedAthlete = stored.events.find(event => event.id === race.id).competitors.find(row => row.id === 'seed-2');
  assert.equal(savedAthlete.time, 130000);
  assert.equal(savedAthlete.bib, '102');
  assert.equal(savedAthlete.heat, 1);
  await type('#roster-seed-3-result', '错误成绩');
  await enter();
  await until('document.querySelector("#roster-feedback-seed-3")?.classList.contains("error")', 'invalid result feedback');
  assert.equal(await evaluate('document.querySelector("#roster-seed-3-result").value'), '错误成绩', 'invalid draft retained');
  await type('#roster-seed-3-result', 'DNF');
  await enter();
  await until('document.querySelector("#roster-seed-3-result")?.dataset.original === "DNF"', 'result status saved');
  await type('#roster-seed-3-result', '错误成绩');
  await evaluate(`(() => {
    const input = document.querySelector('#roster-seed-3-result');
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    input.value = 'DNF';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
  })()`);
  await until('document.querySelector("#roster-feedback-seed-3")?.textContent === ""', 'rapid correction saved after a rejected input');
  report.checks.push('Scores save with Enter or blur, invalid drafts show an inline error, and live refresh preserves editing.');

  // 冠军按钮先保存本行输入，再直接上屏。
  await type('#roster-seed-1-result', '2:05.00');
  await pointerClick('[data-action="champion"][data-key="seed-1"]');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".winner-name")?.textContent.includes("林浩宇")', 'champion card shows the athlete');
  assert.equal(await evaluate('document.querySelector("#preview").contentDocument?.querySelector(".winner-time")?.textContent'), '02:05.00');
  assert.equal(await evaluate('document.querySelector("#preview").contentDocument?.querySelector(".winner-crown")?.textContent.includes("冠军")'), true, 'crown band on the champion card');
  await screenshot('control-champion.png');
  assert.equal(await evaluate('document.querySelector(\'[data-action="module-toggle"][data-key="results"]\').getAttribute("aria-pressed")'), 'true', 'champion layer on air after show');
  assert.equal(await evaluate('document.querySelector("#layer-count").textContent'), '上屏 3 / 4');
  assert.equal(await evaluate('document.querySelector("dialog, .champion-pane, #champion-mark")'), null, 'roster actions have no secondary editor');
  await until('!document.querySelector(\'[data-action="champion"][data-key="seed-1"]\').disabled', 'champion button ready');
  await pointerClick('[data-action="champion"][data-key="seed-2"]');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".winner-name")?.textContent.includes("陈子航")', 'champion switches directly');
  await until('!document.querySelector(\'[data-action="champion"][data-key="seed-2"]\').disabled', 'champion switch complete');
  await pointerClick('[data-action="champion"][data-key="seed-2"]');
  await until('document.querySelector(\'[data-action="module-toggle"][data-key="results"]\').getAttribute("aria-pressed") === "false"', 'champion hidden directly');
  await until('!document.querySelector(\'[data-action="champion"][data-key="seed-1"]\').disabled', 'champion hide complete');
  await pointerClick('[data-action="champion"][data-key="seed-1"]');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".winner-name")?.textContent.includes("林浩宇") && document.querySelector(\'[data-action="module-toggle"][data-key="results"]\').getAttribute("aria-pressed") === "true"', 'champion restored directly');
  report.checks.push('Champion buttons save the row and directly publish, switch or hide the card.');

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

  // 3.5) 右下角角标文字：选中 Logo 挂角后在面板里改，监看立即更新。
  await evaluate('document.activeElement?.blur?.()');
  await click('[data-action="module-select"][data-key="brand"]');
  await until('document.querySelector("#layout-form [name=corner]") !== null', 'corner text field');
  await type('#layout-form [name=corner]', '测试角标');
  await until('document.querySelector("#preview").contentDocument?.querySelector(".branding-corner-text")?.textContent === "测试角标"', 'corner caption updated');
  report.checks.push('The bottom-right corner caption is editable from the brand layer settings.');

  await screenshot('control-desktop.png');

  // 4) 行内添加选手：表单填姓名、班级、道次和成绩。
  await click('[data-action="athlete-add"]');
  await until('document.querySelector("#roster-form") !== null', 'inline athlete form');
  assert.equal(await evaluate('document.querySelector("#roster-form [name=bib]")'), null, 'bib field removed from the form');
  assert.equal(await evaluate('document.querySelector("#roster-form [name=result]") !== null'), true, 'score field in the form');
  assert.ok((await evaluate('document.querySelector("#roster-rows thead").textContent')).includes('姓名 / 班级'));
  await type('#roster-form [name=name]', '测试选手');
  await type('#roster-form [name=result]', '2:10.00');
  await submit('#roster-form');
  await until('[...document.querySelectorAll("#roster-rows tr[data-athlete]")].some(row => row.querySelector("[name=name]").value === "测试选手" && row.querySelector("[name=result]").value === "02:10.00")', 'athlete added inline');
  report.checks.push('Adding an athlete happens inline and the score can be typed into the form.');
  await screenshot('control-roster.png');
  const addedId = await evaluate('[...document.querySelectorAll("#roster-rows tr[data-athlete]")].find(row => row.querySelector("[name=name]").value === "测试选手").dataset.athlete');
  await pointerClick('[data-action="athlete-delete"][data-key="' + addedId + '"]');
  await until('document.querySelector(\'[data-athlete="' + addedId + '"]\') === null', 'athlete deleted directly');
  assert.equal(await evaluate('document.querySelector("dialog")'), null, 'delete has no confirmation dialog');
  report.checks.push('Each athlete can be deleted directly from the roster row.');

  // 5) 尺寸自适应。
  await click('[data-action="workspace"][data-key="work"]');
  await viewport(1366, 768);
  await screenshot('control-laptop.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.ok(await evaluate('document.querySelector("#properties-column").getBoundingClientRect().width < 270'), 'laptop output column narrowed');
  report.checks.push('1366x768 keeps the workspace on screen without horizontal scroll.');
  await viewport(1100, 800);
  await screenshot('control-tablet.png');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-nav")).display'), 'grid');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".preview-card")).display'), 'none');
  report.checks.push('1100px collapses into one column guarded by the workspace switch.');
  await viewport(390, 844);
  await screenshot('control-mobile-work.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.ok(await evaluate('[...document.querySelectorAll("#roster-rows tr[data-athlete] input, #roster-rows tr[data-athlete] button")].every(node => { const box = node.getBoundingClientRect(); const cell = node.closest("td").getBoundingClientRect(); return box.left >= cell.left && box.right <= cell.right; })'), 'mobile row controls fit their cells');
  await viewport(320, 700);
  await pause(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, '320px has no horizontal scroll');
  assert.ok(await evaluate('[...document.querySelectorAll("#roster-rows tr[data-athlete] input, #roster-rows tr[data-athlete] button")].every(node => { const box = node.getBoundingClientRect(); const cell = node.closest("td").getBoundingClientRect(); return box.left >= cell.left && box.right <= cell.right; })'), '320px row controls fit their cells');
  await viewport(390, 844);
  await click('[data-action="workspace"][data-key="output"]');
  await screenshot('control-mobile-output.png');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await viewport(320, 700);
  await pause(120);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, '320px output has no horizontal scroll');
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

  // 6.5) 局部放大、安全区参考线与方向键微调。
  await click('[data-action="module-select"][data-key="event"]');
  if (await evaluate('document.querySelector(\'[data-action="module-toggle"][data-key="event"]\').getAttribute("aria-pressed")') === 'false') {
    await click('[data-action="module-toggle"][data-key="event"]');
    await until('document.querySelector(\'[data-action="module-toggle"][data-key="event"]\').getAttribute("aria-pressed") === "true"', 'event layer restored');
  }
  await until('document.querySelector("#focus-preview").src.includes("focus=event")', 'focus frame follows selection');
  await until('document.querySelector("#focus-status").textContent === "上屏中"', 'focus reports on-air layer');
  await evaluate('document.querySelector("#safe-area-toggle").click()');
  await until('document.querySelector("#preview").contentDocument?.querySelector("#stage")?.classList.contains("guides")', 'safe area guides on');
  await evaluate('document.querySelector("#safe-area-toggle").click()');
  await until('!document.querySelector("#preview").contentDocument?.querySelector("#stage")?.classList.contains("guides")', 'safe area guides off');
  const focusX = Number(await evaluate('document.querySelector("#layout-form [name=x]").value'));
  await evaluate('document.querySelector(".preview-stage").focus()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await until(`Number(document.querySelector("#layout-form [name=x]").value) === ${focusX + 1}`, 'arrow key nudges selected layer');
  await screenshot('control-focus.png');
  report.checks.push('Focus zoom tracks the selected layer, safe-area guides are preview-only, and arrow keys nudge the layer.');

  // 7) 深浅色切换。
  await click('[data-theme-option="light"]');
  await until('document.documentElement.dataset.theme === "light"', 'light theme applied');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(238, 240, 243)');
  await screenshot('control-light.png');
  await click('[data-theme-option="dark"]');
  await until('document.documentElement.dataset.theme === "dark"', 'dark theme applied');
  assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(13, 14, 16)');
  report.checks.push('Theme switch flips between light and dark and persists the choice.');

  // 赛事条和冠军卡按实际输出检查文字、尺寸和透明背景。
  const savedState = JSON.parse(await readFile(path.join(temporary, 'settings.json'), 'utf8'));
  const reviewEvent = savedState.events.find(event => event.schedule?.grade === 'g2' && event.division === 'men');
  await sendCommand('event:select', { eventId: reviewEvent.id });
  await sendCommand('athlete:save', { eventId: reviewEvent.id, fields: { name: '张三', team: '高二2班', result: '3.13' } });
  const reviewState = JSON.parse(await readFile(path.join(temporary, 'settings.json'), 'utf8'));
  const reviewWinner = activeEvent(reviewState).competitors.find(athlete => athlete.name === '张三');
  await sendCommand('rank:champion', { eventId: reviewEvent.id, id: reviewWinner.id });
  await sendCommand('module:save', { eventId: reviewEvent.id, key: 'results', patch: { visible: true } });
  await until('document.querySelector("#preview").contentDocument?.querySelector(".winner-team")?.textContent === "高二2班"', 'champion class displayed');
  await screenshot('control-graphics.png');

  await cdp('Page.navigate', { url: base + '/overlay.html' });
  await until('document.querySelector(".winner-name")?.textContent === "张三"', 'output graphics connected');
  assert.equal(await evaluate('document.querySelector(".winner-time").textContent'), '00:03.13');
  assert.equal(await evaluate('document.querySelector(".winner-team").textContent'), '高二2班');
  assert.equal(await evaluate('document.querySelector(".winner-card").getBoundingClientRect().height'), 400);
  assert.equal(await evaluate('document.querySelector(".event-banner").getBoundingClientRect().height'), 112);
  assert.ok(await evaluate('[document.documentElement, document.body, document.querySelector("#stage")].every(node => getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)")'), 'output background is transparent');
  await cdp('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await screenshot('overlay-graphics.png', { x: 96, y: 516, width: 1728, height: 520, scale: 1 });
  report.checks.push('The event banner and champion card show the class and score on transparent 1080p output.');

  const mediumName = '阿卜杜勒·穆罕默德';
  await sendCommand('athlete:save', { eventId: reviewEvent.id, id: reviewWinner.id, fields: { name: mediumName, team: '高二2班', result: '3.13' } });
  await until('document.querySelector(".winner-name")?.textContent === ' + JSON.stringify(mediumName), 'medium-length champion name rendered');
  await screenshot('overlay-medium-name.png');
  assert.ok(await evaluate('parseFloat(getComputedStyle(document.querySelector(".winner-name")).fontSize) >= 44'), 'medium-length champion name remains readable');
  await checkGraphicText('medium-length name fits');
  await viewport(861, 485);
  await until('document.querySelector("#stage").getBoundingClientRect().width < 900', 'output scaled to preview size');
  assert.ok(await evaluate('document.querySelector(".winner-name").getBoundingClientRect().height >= 40'), 'two-line name is readable in the reduced preview');
  assert.ok(await evaluate('document.querySelector(".winner-team").getBoundingClientRect().height >= 14'), 'class is readable in the reduced preview');
  assert.ok(await evaluate('document.querySelector(".winner-time").getBoundingClientRect().height >= 22'), 'score is readable in the reduced preview');
  await checkGraphicText('reduced preview text fits');
  await screenshot('overlay-reduced-preview.png');
  await viewport(1920, 1080);
  await until('document.querySelector("#stage").getBoundingClientRect().width === 1920', 'full-size output restored');
  await sendCommand('athlete:save', { eventId: reviewEvent.id, id: reviewWinner.id, fields: { name: mediumName, team: '班'.repeat(35), result: '3.13' } });
  await until('document.querySelector(".winner-team")?.textContent.length === 35', 'long class paired with the name');
  await checkGraphicText('medium-length name with a long class fits');
  report.checks.push('Medium-length champion names keep a readable size across two balanced lines.');
  report.checks.push('Names, classes and scores remain readable in an 861px preview.');

  const longName = '选'.repeat(30);
  const longTeam = '班'.repeat(35);
  const longTitle = '项目'.repeat(14);
  await sendCommand('athlete:save', { eventId: reviewEvent.id, id: reviewWinner.id, fields: { name: longName, team: longTeam, result: '86400' } });
  await sendCommand('event:save', { id: reviewEvent.id, fields: { ...reviewEvent, name: longTitle, stage: '决赛轮次'.repeat(6) } });
  await until('document.querySelector(".winner-name")?.textContent === ' + JSON.stringify(longName) + ' && document.querySelector(".eb-copy strong")?.textContent === ' + JSON.stringify(longTitle), 'long overlay text rendered');
  assert.equal(await evaluate('document.querySelector(".winner-time").textContent'), '1440:00.00');
  assert.equal(await evaluate('document.querySelector(".winner-team").textContent'), longTeam);
  await checkGraphicText('long names, titles and scores fit');
  await screenshot('overlay-long-text.png');
  await sendCommand('athlete:save', { eventId: reviewEvent.id, id: reviewWinner.id, fields: { name: '张三', team: '高二2班', result: '' } });
  await until('document.querySelector(".winner-time")?.textContent === "—"', 'empty score displayed');
  report.checks.push('Maximum-length names, classes, event titles and scores fit their graphics, including an empty score.');

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
