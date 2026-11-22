import { SportsClient, pageUrl } from './client.js';
import { Dialogs } from './control-dialogs.js';
import { athleteFields, athleteForm, button, competitorPanel, currentEventPicker, divisionPicker, icon, inspector, moduleList, operations, pager, rosterPicker, rosterTools } from './control-views.js';
import { createRanking } from './ranking.js';
import { createMeetDesk, raceActions } from './meet-control.js';
import { compareSchedule, finalFor, onProgram, topRows } from './meet-program.js';
import { MODULES, activeEvent, applicable, clamp, eventRound, eventTitle, formatTime, jumpHeight, moduleBounds, modulePosition, nextJumpHeight, safeAnchor, sameProject } from './sport.js';

const $ = (selector) => document.querySelector(selector);
const workspace = $('.app-shell');
const stages = Array.from(document.querySelectorAll('.preview-stage, .focus-stage'));
const canvas = document.querySelector('.monitor-canvas');
const preview = $('#preview');
const output = pageUrl('overlay');
const connection = $('#connection');
const layoutPane = $('#layout-inspector');
const rosterView = { page: 0, limit: 6 };
const HIDDEN_LAYERS = ['teams', 'score'];
const regionMarkup = new WeakMap();
let state;
let switchingFocus = false;
let renderedEventId;
let renderedRosterId;
let preparedId = '';
let rosterEditing = null;
let toastTimer;
let saveTimer;
let layoutKey = 'brand';
let layoutDirty = false;
let layoutModel;
let backdrop = 'grid';
let guides = true;

try {
  const prefs = JSON.parse(localStorage.getItem('yanzhou-sports-preview'));
  if (['track', 'grid', 'dark'].includes(prefs?.backdrop)) backdrop = prefs.backdrop;
  if (typeof prefs?.guides === 'boolean') guides = prefs.guides;
} catch { /* Preserve defaults if browser storage is unavailable. */ }

const initialIcons = {
  '#new-event': 'plus', '#edit-active': 'edit', '#copy-output': 'copy', '#open-output': 'external',
  '#open-meet': 'info',
};
for (const [selector, glyph] of Object.entries(initialIcons)) $(selector).insertAdjacentHTML('afterbegin', icon(glyph));
$('#open-output').href = output;
for (const stage of stages) stage.dataset.backdrop = backdrop;
$('#monitor-guides').checked = guides;
syncBackdropButtons();

function setWorkspace(key) {
  workspace.dataset.workspace = key;
  document.querySelectorAll('.mobile-nav button').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.key === key)));
}

function setTableView(view) {
  $('#work-panel').dataset.view = view;
  document.querySelectorAll('.work-tabs button').forEach((tab) => {
    const selected = tab.dataset.key === view;
    tab.setAttribute('aria-pressed', String(selected));
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  });
  setWorkspace('work');
}

function syncBackdropButtons() {
  document.querySelectorAll('[data-action="backdrop"]').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.key === backdrop)));
}

function saveMonitorPreferences() {
  for (const stage of stages) stage.dataset.backdrop = backdrop;
  guides = $('#monitor-guides').checked;
  try { localStorage.setItem('yanzhou-sports-preview', JSON.stringify({ backdrop, guides })); } catch { /* The current preview still updates. */ }
  tellPreview();
}
$('#monitor-guides').addEventListener('change', saveMonitorPreferences);

function tellPreview(extra = {}) {
  preview.contentWindow?.postMessage({ type: 'preview:settings', editKey: layoutKey, guides, ...extra }, location.origin);
}
preview.addEventListener('load', () => tellPreview());
preview.src = pageUrl('overlay', { preview: '1' });
$('#focus-frame').src = pageUrl('overlay');

const client = new SportsClient({
  role: 'control',
  onState(next) { state = next; render(); },
  onConnection(ready) {
    connection.classList.toggle('connection--online', ready);
    connection.textContent = ready ? '本机已连接' : '正在重连';
    $('#status-sync').textContent = ready ? '已连接本机服务 · 正式直播' : '连接中断，正在重连…';
    $('#status-sync').classList.toggle('offline', !ready);
    if (!ready) {
      $('#save-status').textContent = '未连接';
      $('#save-status').className = 'save-status offline';
    }
  },
});

const dialogs = new Dialogs(async (action, args) => {
  await run(action, args);
  if (action === 'event:save' && !args.id) setTableView('ranking');
});

function notify(text, failure = false) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.toggle('toast--error', failure);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, failure ? 5700 : 2100);
}

function markSaved(error) {
  const label = $('#save-status');
  clearTimeout(saveTimer);
  if (error) {
    label.textContent = '保存失败，请重试';
    label.className = 'save-status error';
    return;
  }
  const now = new Date();
  const time = now.toTimeString().slice(0, 8);
  label.textContent = `已保存 · ${time}`;
  label.className = 'save-status';
  saveTimer = setTimeout(() => { label.textContent = '自动保存，无需手动点击'; }, 8000);
}

async function run(action, args, message) {
  $('#save-status').className = 'save-status saving';
  $('#save-status').textContent = '保存中…';
  try {
    await client.command(action, args);
    markSaved();
  } catch (error) {
    markSaved(true);
    throw error;
  }
  if (message) notify(message);
}

function renderLayout() {
  if (!layoutDirty) {
    const model = JSON.stringify([layoutKey, state.modules[layoutKey], activeEvent(state)?.kind]);
    if (layoutModel !== model) {
      layoutPane.innerHTML = inspector({ state, key: layoutKey });
      layoutModel = model;
    }
  }
  updateFocus();
}

function editLayout() {
  if (!layoutDirty) return state.modules[layoutKey];
  const form = $('#layout-form');
  if (!form) return state.modules[layoutKey];
  const value = (name) => {
    const input = form.elements[name];
    if (!input || input.value === '') return state.modules[layoutKey][name];
    const parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : state.modules[layoutKey][name];
  };
  return { ...state.modules[layoutKey], x: value('x'), y: value('y'), scale: value('scale') };
}

function updateFocus() {
  const frame = $('#focus-frame');
  const stage = document.querySelector('.focus-stage');
  if (!frame || !stage || !state) return;
  if (frame.dataset.focus !== layoutKey) {
    frame.dataset.focus = layoutKey;
    frame.src = pageUrl('overlay', { focus: layoutKey });
  }
  const meta = MODULES[layoutKey];
  $('#focus-title').textContent = `${meta.title} · 局部放大`;
  const layout = editLayout();
  const width = meta.w * layout.scale / 100;
  const height = meta.h * layout.scale / 100;
  const box = stage.getBoundingClientRect();
  const fit = Math.min((box.width - 48) / width, (box.height - 48) / height);
  const scale = clamp(fit, 0.2, 6);
  const { x, y } = modulePosition(layoutKey, layout);
  frame.style.transform = `translate(${((box.width - width * scale) / 2 - x * scale).toFixed(1)}px, ${((box.height - height * scale) / 2 - y * scale).toFixed(1)}px) scale(${scale.toFixed(3)})`;
  $('#focus-scale').textContent = `${Math.round(scale * 100)}%`;
}

new ResizeObserver(() => updateFocus()).observe(document.querySelector('.focus-stage'));
new ResizeObserver(([entry]) => {
  const width = Math.max(0, Math.min(entry.contentRect.width, entry.contentRect.height * 16 / 9));
  canvas.style.width = `${width.toFixed(1)}px`;
  canvas.style.height = `${(width * 9 / 16).toFixed(1)}px`;
  const zoom = $('#preview-zoom');
  if (zoom) zoom.textContent = width > 40 ? `${Math.round(width / 1920 * 100)}%` : '—';
}).observe(document.querySelector('.preview-stage'));

function updateRegion(selector, markup) {
  const node = $(selector);
  if (!node || regionMarkup.get(node) === markup) return;
  const focus = document.activeElement;
  const action = node.contains(focus) ? focus.dataset.action : null;
  const focusId = node.contains(focus) ? focus.id : null;
  node.innerHTML = markup;
  regionMarkup.set(node, markup);
  if (action) {
    const targets = [...node.querySelectorAll(`[data-action="${CSS.escape(action)}"]:not(:disabled)`)];
    const sameKey = targets.filter((entry) => entry.dataset.key === focus.dataset.key);
    const next = sameKey.find((entry) => entry.dataset.value === focus.dataset.value) ?? sameKey[0];
    next?.focus({ preventScroll: true });
  } else if (focusId) node.querySelector(`#${CSS.escape(focusId)}`)?.focus({ preventScroll: true });
}

const ranking = createRanking({ getState: () => state, run, notify, updateRegion, confirm: (...args) => dialogs.confirm(...args) });
const meetDesk = createMeetDesk({ getState: () => state, updateRegion });

function rosterEvent() {
  return state.events.find((event) => event.id === preparedId) ?? activeEvent(state);
}

function renderRoster() {
  if (preparedId && !state.events.some((event) => event.id === preparedId)) preparedId = '';
  const event = rosterEvent();
  if (event?.id !== renderedRosterId) {
    rosterView.page = 0;
    if (rosterEditing === 'new') rosterEditing = null;
  }
  renderedRosterId = event?.id;
  updateRegion('#prep-event-picker', rosterPicker(state.events.filter(onProgram), state.activeEventId, preparedId));
  const total = Math.max(1, Math.ceil((event?.competitors.length ?? 0) / rosterView.limit));
  rosterView.page = clamp(rosterView.page, 0, total - 1);
  const stagedJump = event?.schedule?.project === 'high-jump' && event.id !== state.activeEventId;
  updateRegion('#roster-tools', rosterTools(event) + (stagedJump ? button(`横杆 ${jumpHeight(event)} cm · 升杆`, {
    action: 'jump-raise', small: true, disabled: nextJumpHeight(event) > 300,
  }) : ''));
  const editingAthlete = event?.competitors.find((athlete) => athlete.id === rosterEditing);
  updateRegion('#roster-editor', event && (rosterEditing === 'new' || editingAthlete) ? athleteForm(event, editingAthlete) : '');
  updateRegion('#roster-rows', competitorPanel(event, { start: rosterView.page * rosterView.limit, limit: rosterView.limit, onAir: event?.id === state.activeEventId }));
  updateRegion('#roster-pager', total > 1 ? pager('roster-page', rosterView.page, total, '备赛名单') : '');
  $('#roster-summary').textContent = event && event.competitors.length ? `${event.competitors.length} 位选手` : '';
  $('#roster-rows').style.setProperty('--roster-count', String(event?.competitors.length ?? 0));
  if (rosterEditing && !$('#roster-editor form')) rosterEditing = null;
}

$('#prep-event-picker').addEventListener('change', (e) => {
  if (e.target.id !== 'prep-event') return;
  preparedId = e.target.value;
  rosterEditing = null;
  renderRoster();
});

$('#module-list').addEventListener('change', async ({ target }) => {
  if (!target.matches('[data-lineup-page]') || !state) return;
  const eventId = target.dataset.eventId;
  const page = Number(target.value);
  target.disabled = true;
  try { await run('page:set', { eventId, key: 'lineup', page }); }
  catch (error) {
    if (state.activeEventId === eventId) target.value = String(state.pages.lineup);
    notify(error.message, true);
  }
  finally { target.disabled = false; }
});

function renderLayers(event) {
  const available = Object.keys(MODULES).filter((key) => !HIDDEN_LAYERS.includes(key) && applicable(key, event));
  const visible = available.filter((key) => state.modules[key].visible).length;
  $('#layer-count').textContent = `上屏 ${visible} / ${available.length}`;
  updateRegion('#module-list', moduleList(state, event, layoutKey));
}

function renderQuickEntry(event) {
  const form = $('#quick-entry');
  const jumps = event?.schedule?.project === 'high-jump';
  const field = event?.kind === 'field';
  form.hidden = !event || event.kind === 'match';
  if (form.hidden) return;
  $('#qe-mark-label').textContent = field ? (jumps ? '试跳 O / X / -' : '试次') : '成绩';
  const input = $('#qe-mark');
  input.placeholder = field ? (jumps ? 'O' : '5.35 或 X') : '03:21.52';
  input.inputMode = field && !jumps ? 'decimal' : 'text';
  const list = $('#qe-options');
  const options = (event?.competitors ?? []).map((athlete) => `<option value="${athlete.bib || athlete.name}">${athlete.name}</option>`).join('');
  if (list.dataset.markup !== options) {
    list.innerHTML = options;
    list.dataset.markup = options;
  }
}

function renderHeader(event) {
  $('#live-event').textContent = event ? eventTitle(event) : '未选择赛事';
  const live = event ? state.modules.results.visible || state.modules.lineup.visible || state.modules.event.visible : false;
  const bits = [];
  if (event) bits.push(`${event.competitors.length} 位选手`);
  if (event?.schedule?.start) bits.push(`${event.schedule.start.slice(5, 10).replace('-', '/')} · ${event.schedule.start.slice(11, 16)} 开赛`);
  else if (event) bits.push('时间待定');
  bits.push(live ? '画面进行中' : '待机');
  $('#live-meta').textContent = bits.join(' · ');
  document.body.dataset.live = String(Boolean(event && live));
}

function renderNextEvent(event) {
  const program = state.events.filter(onProgram).toSorted(compareSchedule);
  const index = event ? program.findIndex((row) => row.id === event.id) : -1;
  const next = program[index + 1] ?? null;
  updateRegion('#event-next', next ? button(`下一场 ${next.schedule.start.slice(11, 16)}`, { action: 'schedule-live', key: next.id, small: true, glyph: 'right', accessible: `下一场 · ${eventTitle(next)}` }) : '');
}

function render() {
  const event = activeEvent(state);
  const program = state.events.filter(onProgram);
  if (!switchingFocus && program.length && event && !onProgram(event)) {
    switchingFocus = true;
    void run('event:select', { eventId: program[0].id }).finally(() => { switchingFocus = false; });
    return;
  }
  if (renderedEventId !== state.activeEventId) {
    renderedEventId = state.activeEventId;
    layoutDirty = false;
    layoutModel = undefined;
  }
  if (!applicable(layoutKey, event)) { layoutKey = 'brand'; layoutDirty = false; }
  const listed = program.length ? program : state.events;
  updateRegion('#event-divisions', divisionPicker(listed, state.activeEventId));
  updateRegion('#active-event-picker', currentEventPicker(listed, state.activeEventId));
  $('#edit-active').disabled = !event;
  updateRegion('#operations', operations(event));
  renderHeader(event);
  renderNextEvent(event);
  renderRoster();
  renderQuickEntry(event);
  ranking.render();
  updateRegion('#school-race-actions', raceActions(state, event));
  meetDesk.render();
  renderLayers(event);
  renderLayout();
  tellPreview();
}

const rosterContainer = $('#roster-rows');
const paginationObserver = new ResizeObserver(([{ contentRect }]) => {
  if (!contentRect.height) return;
  const styles = getComputedStyle(rosterContainer);
  const row = parseFloat(styles.getPropertyValue('--roster-row'));
  const heading = parseFloat(styles.getPropertyValue('--roster-heading')) + 1;
  const limit = Math.max(1, Math.floor((contentRect.height - heading) / row));
  if (limit === rosterView.limit) return;
  rosterView.page = Math.floor(rosterView.page * rosterView.limit / limit);
  rosterView.limit = limit;
  if (state) renderRoster();
});
paginationObserver.observe(rosterContainer);

async function copyOutput() {
  try { await navigator.clipboard.writeText(output); }
  catch {
    const field = document.createElement('textarea');
    field.value = output;
    field.className = 'clipboard-fallback';
    document.body.append(field);
    field.select();
    let copied;
    try { copied = document.execCommand('copy'); } finally { field.remove(); }
    if (!copied) throw new Error('浏览器限制复制，请在「直播信息」中选中输出地址。');
  }
  notify('已复制 OBS 透明图层地址');
}

function selectModule(key) {
  if (!applicable(key, activeEvent(state))) key = 'brand';
  if (layoutKey !== key) {
    layoutKey = key;
    layoutDirty = false;
    layoutModel = undefined;
  }
  setWorkspace('output');
  renderLayers(activeEvent(state));
  renderLayout();
  tellPreview();
}

function formScale(form) {
  const scale = Number(form.elements.scale.value) || state.modules[layoutKey].scale;
  return clamp(scale, 35, Number(form.elements.scale.max));
}

function updatePositionBounds(form) {
  const bounds = moduleBounds(layoutKey, formScale(form));
  for (const axis of ['x', 'y']) {
    const range = form.querySelector('[data-range="' + axis + '"]');
    form.elements[axis].max = bounds[axis];
    if (range) range.max = bounds[axis];
    if (Number(form.elements[axis].value) > bounds[axis]) form.elements[axis].value = bounds[axis];
    if (range && Number(range.value) > bounds[axis]) range.value = bounds[axis];
  }
}

async function selectEvent(next) {
  if (!next || next.id === state.activeEventId) return;
  await run('event:select', { eventId: next.id });
  setTableView('ranking');
}

function setQeStatus(text, error = false) {
  const node = $('#qe-status');
  node.textContent = text;
  node.classList.toggle('is-error', error);
  node.classList.toggle('is-ok', !error && Boolean(text));
}

function matchAthlete(event, raw) {
  const value = raw.trim();
  if (!value) throw new Error('先填写号码或姓名。');
  const lower = value.toLowerCase();
  const rows = event.competitors;
  const byBib = rows.filter((athlete) => athlete.bib && athlete.bib.toLowerCase() === lower);
  if (byBib.length === 1) return byBib[0];
  const byName = rows.filter((athlete) => athlete.name === value);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new Error(`有 ${byName.length} 位选手都叫「${value}」，请填写号码。`);
  const fuzzy = rows.filter((athlete) => athlete.name.includes(value) || (athlete.bib && athlete.bib.toLowerCase().includes(lower)));
  if (fuzzy.length === 1) return fuzzy[0];
  if (!fuzzy.length) throw new Error(`名单里没有「${value}」，可在备赛名单添加。`);
  throw new Error(`「${value}」匹配到 ${fuzzy.length} 位选手，请填写号码。`);
}

async function submitQuickEntry(event) {
  event.preventDefault();
  if (!state) return;
  const current = activeEvent(state);
  if (!current) return;
  const who = $('#qe-athlete').value;
  const markInput = $('#qe-mark');
  const mark = markInput.value.trim();
  if (!mark) { setQeStatus('先填成绩再录入。', true); markInput.focus(); return; }
  try {
    const athlete = matchAthlete(current, who);
    const upper = mark.toUpperCase();
    if (current.schedule?.project === 'high-jump') {
      if (!['O', 'X', '-'].includes(upper)) throw new Error('跳高只接受 O（过杆）、X（失败）、-（免跳）。');
      await run('jump:mark', { eventId: current.id, id: athlete.id, height: jumpHeight(current), outcome: upper, index: athlete.jumps?.length ?? 0 });
    } else if (current.kind === 'field') {
      await run('athlete:attempt', { eventId: current.id, id: athlete.id, value: upper === 'X' || upper === '-' ? upper : mark, index: athlete.attempts?.length ?? 0 });
    } else {
      await run('athlete:save', { eventId: current.id, id: athlete.id, fields: { ...athleteFields(athlete), result: mark, status: '' } });
    }
    setQeStatus(`${athlete.name} ${athlete.bib ? `· ${athlete.bib}` : ''} 已记录 ${mark}`);
    $('#qe-athlete').value = '';
    markInput.value = '';
    $('#qe-athlete').focus();
  } catch (error) {
    setQeStatus(error.message, true);
    notify(error.message, true);
  }
}

$('#quick-entry').addEventListener('submit', (event) => { void submitQuickEntry(event); });

document.querySelector('#roster-editor').addEventListener('submit', async (event) => {
  const form = event.target.closest('#roster-form');
  if (!form) return;
  event.preventDefault();
  const eventId = form.dataset.event;
  const id = form.dataset.athlete;
  const data = new FormData(form);
  const picks = (name) => String(data.get(name) ?? '').trim();
  const fields = { name: picks('name'), bib: picks('bib'), team: picks('team'), lane: picks('lane') };
  for (const extra of ['heat', 'boys', 'girls']) if (data.has(extra)) fields[extra] = picks(extra);
  if (data.has('result')) fields.result = picks('result');
  if (data.has('attempts')) fields.attempts = picks('attempts');
  if (data.has('jumps')) fields.jumps = picks('jumps');
  fields.status = picks('status');
  try {
    await run('athlete:save', { eventId, id: id || undefined, fields }, id ? '选手已更新' : '选手已添加');
    rosterEditing = null;
    renderRoster();
  } catch (error) {
    notify(error.message, true);
  }
});

const handlers = {
  copy: copyOutput,
  workspace({ key }) { setWorkspace(key); },
  async division({ event, key }) {
    if (event?.division === key) return;
    const candidates = state.events.filter((row) => row.division === key);
    const cohort = candidates.filter((row) => row.schedule?.grade === event?.schedule?.grade);
    const paired = event ? cohort.filter((row) => sameProject(row, event)) : [];
    const next = paired.find((row) => eventRound(row.stage) === eventRound(event.stage)) ?? paired[0] ?? cohort[0] ?? candidates[0];
    if (!next) return dialogs.event(undefined, key);
    await selectEvent(next);
    // 换组别时先把上一场的画面收干净，只留左上角 Logo，避免旧成绩停在直播画面上。
    const stale = Object.entries(state.modules).some(([name, layout]) => name !== 'brand' && layout.visible);
    if (stale) await run('modules:brand-only', { eventId: state.activeEventId }, '已切换组别，画面只保留 Logo');
  },
  'new-event'({ event }) { dialogs.event(undefined, event?.division); },
  'edit-event'({ event }) { if (event) dialogs.event(event); },
  'schedule-live'({ key }) { return selectEvent(state.events.find((row) => row.id === key)); },
  'schedule-prep'({ key }) { preparedId = key; rosterEditing = null; renderRoster(); setTableView('roster'); },
  'schedule-page'({ value }) { meetDesk.setPage('schedule', value); },
  'points-page'({ value }) { meetDesk.setPage('points', value); },
  'points-confirm'({ event }) {
    const scored = !event.schedule.scored;
    dialogs.confirm(scored ? '确认计入团体分？' : '撤回本场计分？',
      scored ? `将「${eventTitle(event)}」已确认的前八名计入班级积分。请先核对裁判结果和班级。` : '本场得分将从班级积分中移除，可以重新确认。',
      scored ? '计入班级积分' : '撤回积分', () => run('points:confirm', { eventId: event.id, scored }, scored ? '已计入班级积分' : '已撤回计分'));
  },
  qualify({ event }) {
    const final = finalFor(state.events, event);
    if (!final) return;
    dialogs.confirm('将前八名带入决赛？', `按当前名次将 ${Math.min(topRows(event).length, 8)} 位选手加入「${eventTitle(final)}」的备赛名单。请再按秩序册分配决赛道次。`, '生成决赛名单', async () => {
      await run('round:qualify', { eventId: event.id }, '已生成决赛名单');
      preparedId = final.id;
      renderRoster();
      setTableView('roster');
    });
  },
  score({ eventId, key, value }) { return run('match:score', { eventId, side: key, delta: value }); },
  period({ event, value }) { return run('match:period', { eventId: event.id, period: clamp((event.match?.period ?? 1) + value, 1, 30) }); },
  'athlete-add'() { rosterEditing = 'new'; renderRoster(); setTableView('roster'); },
  'athlete-edit'({ key }) { rosterEditing = key; renderRoster(); setTableView('roster'); },
  'athlete-form-close'() { rosterEditing = null; renderRoster(); },
  'athlete-delete'({ event, athlete }) {
    return dialogs.confirm('删除选手', `将从「${eventTitle(event)}」名单中删除 ${athlete.name}，成绩和名次一起移除。`, '删除', async () => {
      await run('athlete:delete', { eventId: event.id, id: athlete.id }, '已删除选手');
      rosterEditing = null;
      renderRoster();
    });
  },
  'jump-raise'({ event, eventId }) { return run('jump:raise', { eventId, height: jumpHeight(event) }, '已升杆'); },
  'module-toggle'({ key }) {
    return run('module:save', { eventId: state.activeEventId, key, patch: { visible: !state.modules[key].visible } });
  },
  page({ key, value }) { return run('page:set', { eventId: state.activeEventId, key, page: value }); },
  'roster-page'({ value }) { rosterView.page = value; renderRoster(); },
  meet() { dialogs.meet(state, output); },
  'work-view'({ key }) { setTableView(key); },
  'module-select'({ key }) { selectModule(key); },
  backdrop({ key }) { backdrop = key; saveMonitorPreferences(); syncBackdropButtons(); },
  async 'layout-reset'() {
    const eventId = state.activeEventId;
    const key = layoutKey;
    await run('module:reset', { eventId, key }, '已恢复默认位置和外观');
    if (state.activeEventId !== eventId || layoutKey !== key) return;
    layoutDirty = false;
    layoutModel = undefined;
    renderLayout();
  },
  anchor({ key }) {
    const form = $('#layout-form');
    const { x, y, scale } = safeAnchor(layoutKey, formScale(form), key);
    form.elements.x.value = x;
    form.elements.y.value = y;
    form.elements.scale.value = scale;
    for (const axis of ['x', 'y', 'scale']) {
      const range = form.querySelector('[data-range="' + axis + '"]');
      if (range) range.value = form.elements[axis].value;
    }
    updatePositionBounds(form);
    layoutDirty = true;
  },
};

$('#active-event-picker').addEventListener('change', async ({ target }) => {
  const next = state.events.find((row) => row.id === target.value);
  target.value = state.activeEventId;
  try { await selectEvent(next); }
  catch (error) { notify(error.message, true); }
});

document.addEventListener('click', async (e) => {
  const node = e.target.closest('[data-action]');
  const action = node?.dataset.action;
  if (!Object.hasOwn(handlers, action)) return;
  const { key, value } = node.dataset;
  if (!state && !['copy', 'workspace'].includes(action)) { notify('正在连接本机服务。', true); return; }
  const event = state && (node.closest('#competitors') ? rosterEvent() : activeEvent(state));
  try {
    const result = handlers[action]({ event, eventId: event?.id, key, value: Number(value), athlete: event?.competitors.find((athlete) => athlete.id === key) });
    if (result instanceof Promise) {
      node.disabled = true;
      try { await result; } finally { node.disabled = false; }
    }
  } catch (error) { notify(error.message, true); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !rosterEditing) return;
  rosterEditing = null;
  renderRoster();
});

layoutPane.addEventListener('input', (e) => {
  const range = e.target.closest?.('[data-range]');
  if (range) {
    const form = range.form;
    const numberInput = form.elements[range.dataset.range];
    if (numberInput) numberInput.value = range.value;
    if (range.dataset.range === 'scale') updatePositionBounds(form);
    range.style.setProperty('--range-fill', `${Math.round((Number(range.value) - Number(range.min)) / Math.max(1, Number(range.max) - Number(range.min)) * 100)}%`);
  }
  layoutDirty = true;
  if (e.target.name === 'scale' && e.target.form) updatePositionBounds(e.target.form);
});

layoutPane.addEventListener('submit', async (e) => {
  e.preventDefault();
  const invalid = e.target.querySelector(':invalid');
  if (invalid) {
    invalid.reportValidity();
    return;
  }
  const data = new FormData(e.target);
  const key = layoutKey;
  const eventId = state.activeEventId;
  const patch = Object.fromEntries(['x', 'y', 'scale', 'opacity', 'enter', 'exit', 'duration'].map((attr) => [attr, data.get(attr)]));
  e.submitter.disabled = true;
  try {
    await run('module:save', { eventId, key, patch }, '已应用外观');
    if (state.activeEventId === eventId && layoutKey === key) { layoutDirty = false; layoutModel = undefined; renderLayout(); }
  } catch (error) { notify(error.message, true); }
  finally { e.submitter.disabled = false; }
});

window.addEventListener('message', async ({ source, origin, data }) => {
  if (origin !== location.origin || source !== preview.contentWindow) return;
  if (data?.type === 'preview:ready') tellPreview();
  if (data?.type !== 'preview:move' || data.key !== layoutKey || data.eventId !== state.activeEventId) return;
  try {
    await run('module:save', { eventId: data.eventId, key: data.key, patch: { x: data.x, y: data.y } }, '已保存位置');
    if (layoutDirty && layoutKey === data.key && data.eventId === state.activeEventId) {
      const form = $('#layout-form');
      for (const axis of ['x', 'y']) {
        form.elements[axis].value = state.modules[data.key][axis];
        const range = form.querySelector('[data-range="' + axis + '"]');
        if (range) range.value = state.modules[data.key][axis];
      }
    }
  } catch (error) {
    tellPreview({ resetPosition: true });
    notify(error.message, true);
  }
});
