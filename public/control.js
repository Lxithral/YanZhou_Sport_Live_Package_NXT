import { SportsClient, escapeHtml as h, pageUrl } from './client.js';
import { athleteFields, athleteForm, competitorPanel, inspector, moduleList, pager, rosterTools } from './control-views.js';
import { onProgram } from './meet-program.js';
import { CANVAS, MODULES, OUTPUT_LAYERS, activeEvent, applicable, championAthlete, clamp, defaultLayout, eventTitle, moduleBounds, moduleHasContent, modulePosition, roster, safeAnchor, standings } from './sport.js';


const $ = (selector) => document.querySelector(selector);
const workspace = $('.app-shell');
const canvas = document.querySelector('.monitor-canvas');
const preview = $('#preview');
const connection = $('#connection');
const layoutPane = $('#layout-inspector');
const eventPicker = $('#event-picker');
const rosterView = { page: 0, limit: 6, anchor: 0 };
const regionMarkup = new WeakMap();
const pendingButtons = new WeakSet();
const rosterDrafts = new Map();
const rosterSaves = new Map();
const rosterDeleting = new Set();
const SPECIAL_RESULTS = new Set(['DNS', 'DNF', 'DQ', 'NM']);
const monitor = { backdrop: false, guides: false, edit: false };
const layoutDrafts = new Map();
const collapsedSections = new Set(['appearance', 'motion']);
let state;
let online = false;
let switchingEvent = false;
let renderedRosterId;
let addingAthlete = false;
let championBusy = false;
let refreshingRoster = false;
let toastTimer;
let layoutKey = 'brand';
let renderedLayoutScope;

function setWorkspace(key) {
  workspace.dataset.workspace = key;
  document.querySelectorAll('.mobile-nav button').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.key === key)));
}

function tellPreview(extra = {}) {
  preview.contentWindow?.postMessage({
    type: 'preview:settings', editKey: monitor.edit ? layoutKey : '', guides: monitor.guides, ...extra,
  }, location.origin);
}

function setMonitor(key, value) {
  monitor[key] = value;
  $(`[data-monitor="${key}"]`).setAttribute('aria-pressed', String(value));
  $('.preview-stage').dataset.backdrop = monitor.backdrop ? 'dark' : 'grid';
  tellPreview();
}

$('.preview-tools').addEventListener('click', ({ target }) => {
  const key = target.closest('[data-monitor]')?.dataset.monitor;
  if (key) setMonitor(key, !monitor[key]);
});

const obsUrl = pageUrl('overlay');
$('#obs-url').value = obsUrl;
$('#open-obs').href = obsUrl;
$('#copy-obs').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(obsUrl);
    notify('OBS 输出地址已复制');
  } catch {
    $('#obs-url').focus();
    $('#obs-url').select();
    notify('地址已选中，请手动复制。', true);
  }
});

preview.addEventListener('load', () => tellPreview());
preview.src = pageUrl('overlay', { preview: '1' });

const client = new SportsClient({
  role: 'control',
  onState(next) { state = next; render(); },
  onConnection(ready) {
    online = ready;
    connection.classList.toggle('connection--online', ready);
    connection.textContent = ready ? '本机已连接' : '正在重连';
    if (!ready && state) render();
  },
});

function notify(text, failure = false) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.toggle('toast--error', failure);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, failure ? 5700 : 2100);
}

async function run(action, args, message) {
  await client.command(action, args);
  if (message) notify(message);
}

function updateRegion(selector, markup) {
  const node = $(selector);
  if (!node || regionMarkup.get(node) === markup) return;
  const focus = document.activeElement;
  const action = node.contains(focus) ? focus.dataset.action : null;
  const focusId = node.contains(focus) ? focus.id : null;
  const selection = focusId && Number.isInteger(focus.selectionStart)
    ? { start: focus.selectionStart, end: focus.selectionEnd, direction: focus.selectionDirection }
    : null;
  node.innerHTML = markup;
  regionMarkup.set(node, markup);
  let next;
  if (action) {
    const targets = [...node.querySelectorAll(`[data-action="${CSS.escape(action)}"]:not(:disabled)`)];
    const sameKey = targets.filter((entry) => entry.dataset.key === focus.dataset.key);
    next = sameKey.find((entry) => entry.dataset.value === focus.dataset.value)
      ?? sameKey.find((entry) => entry.getAttribute('aria-label') === focus.getAttribute('aria-label'))
      ?? sameKey[0];
  } else if (focusId) next = node.querySelector(`#${CSS.escape(focusId)}`);
  next?.focus({ preventScroll: true });
  if (next && selection) next.setSelectionRange(selection.start, selection.end, selection.direction);
}

// 监看画布按 16:9 自适应
new ResizeObserver(([entry]) => {
  const width = Math.max(0, Math.min(entry.contentRect.width, entry.contentRect.height * 16 / 9));
  canvas.style.width = `${width.toFixed(1)}px`;
  canvas.style.height = `${(width * 9 / 16).toFixed(1)}px`;
}).observe(document.querySelector('.preview-stage'));

// 局部放大：focus 页只渲染选中图层（?focus=key），再按图层位置缩放居中
const focusStage = document.querySelector('.focus-stage');
const focusFrame = $('#focus-preview');
const focusSize = $('#focus-size');
let focusFrameKey = '';

focusSize.addEventListener('click', () => {
  const expanded = focusStage.closest('.monitor-column').classList.toggle('focus-expanded');
  focusSize.setAttribute('aria-pressed', String(expanded));
});

function renderFocus() {
  if (!state) return;
  const key = layoutKey;
  const meta = MODULES[key];
  const layout = state.modules[key];
  if (!meta || !layout) return;
  if (focusFrameKey !== key) {
    focusFrameKey = key;
    focusFrame.src = pageUrl('overlay', { focus: key });
  }
  $('#preview-selected').textContent = meta.title;
  $('#focus-title').textContent = `${meta.title} · 局部放大`;
  const hasContent = moduleHasContent(key, activeEvent(state));
  const onAir = layout.visible && hasContent;
  const status = $('#focus-status');
  status.textContent = onAir ? '上屏中' : hasContent ? '未上屏' : '暂无内容';
  status.classList.toggle('is-live', onAir);
  const width = focusStage.clientWidth;
  const height = focusStage.clientHeight;
  if (width <= 32 || height <= 24) return;
  const { x, y } = modulePosition(key, layout);
  const w = meta.w * layout.scale / 100;
  const h = meta.h * layout.scale / 100;
  const zoom = Math.min((width - 32) / w, (height - 24) / h, 130 / layout.scale);
  focusFrame.style.width = `${(CANVAS.width * zoom).toFixed(1)}px`;
  focusFrame.style.height = `${(CANVAS.height * zoom).toFixed(1)}px`;
  focusFrame.style.left = `${(width / 2 - (x + w / 2) * zoom).toFixed(1)}px`;
  focusFrame.style.top = `${(height / 2 - (y + h / 2) * zoom).toFixed(1)}px`;
}
new ResizeObserver(() => renderFocus()).observe(focusStage);

function renderHeader(event, onAir) {
  $('#live-event').textContent = event ? eventTitle(event) : '未选择赛事';
  const live = onAir.some((key) => key !== 'brand');
  const bits = [];
  if (event) bits.push(`${event.competitors.length} 位选手`);
  bits.push(live ? '赛事图层在播' : onAir.length ? '仅挂角在播' : '无图层上屏');
  $('#live-meta').textContent = bits.join(' · ');
  document.body.dataset.live = String(online && live);
}

function renderTakeButton() {
  eventPicker.disabled = switchingEvent || !state?.events.length;
  $('#take-event').disabled = !online || switchingEvent || !eventPicker.value || eventPicker.value === state.activeEventId;
}

function renderEventPicker() {
  const program = state.events.filter(onProgram);
  const others = state.events.filter((event) => !onProgram(event));
  const option = (event) => `<option value="${h(event.id)}">${h(eventTitle(event))}</option>`;
  const group = (name, events) => events.length ? `<optgroup label="${name}">${events.map(option).join('')}</optgroup>` : '';
  const selection = eventPicker.dataset.current === state.activeEventId && state.events.some(({ id }) => id === eventPicker.value)
    ? eventPicker.value : state.activeEventId;
  updateRegion('#event-picker', group('直播项目', program) + group('其他已存赛事', others) || '<option value="">暂无赛事</option>');
  eventPicker.value = selection ?? '';
  eventPicker.dataset.current = state.activeEventId;
  initThemedSelects($('#event-switch'));
  renderTakeButton();
}

eventPicker.addEventListener('change', renderTakeButton);
$('#event-switch').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('#take-event').disabled) return;
  const eventId = eventPicker.value;
  const fromEventId = state.activeEventId;
  switchingEvent = true;
  renderTakeButton();
  flushLayout();
  try {
    await run('event:select', { eventId, fromEventId }, '已切换上屏赛事');
  } catch (error) {
    notify(error.message, true);
  } finally {
    switchingEvent = false;
    renderTakeButton();
  }
});

function draftsFor(eventId) {
  if (!rosterDrafts.has(eventId)) rosterDrafts.set(eventId, new Map());
  return rosterDrafts.get(eventId);
}

function renderRoster() {
  const event = activeEvent(state);
  if (event?.id !== renderedRosterId) {
    rosterView.page = 0;
    rosterView.anchor = 0;
    addingAthlete = false;
  }
  renderedRosterId = event?.id;
  const drafts = draftsFor(event?.id);
  for (const id of drafts.keys()) {
    if (!event?.competitors.some((athlete) => athlete.id === id)) drafts.delete(id);
  }
  const total = Math.max(1, Math.ceil((event?.competitors.length ?? 0) / rosterView.limit));
  rosterView.page = clamp(rosterView.page, 0, total - 1);
  updateRegion('#roster-tools', rosterTools(event?.kind === 'match' ? null : event));
  updateRegion('#roster-editor', event && addingAthlete ? athleteForm(event) : '');
  refreshingRoster = true;
  try {
    updateRegion('#roster-rows', competitorPanel(event, {
      start: rosterView.page * rosterView.limit,
      limit: rosterView.limit,
      drafts,
      deleting: rosterDeleting,
      resultsVisible: state.modules.results.visible,
      online,
    }));
  } finally { refreshingRoster = false; }
  updateRegion('#roster-pager', pager('roster-page', rosterView.page, total));
  $('#roster-rows').style.setProperty('--roster-count', String(event?.competitors.length ?? 0));
}

// 可定制下拉：给原生 select 注入触发器，配合 appearance: base-select 渲染成深色菜单
function initThemedSelects(root = document) {
  if (!CSS.supports('appearance', 'base-select')) return;
  for (const select of root.querySelectorAll('select:not([multiple])')) {
    if (select.querySelector(':scope > .select-display')) continue;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'select-display';
    trigger.append(document.createElement('selectedcontent'));
    select.prepend(trigger);
  }
}

function renderLayers(event) {
  const available = OUTPUT_LAYERS.filter((key) => applicable(key, event));
  const visible = available.filter((key) => state.modules[key].visible && moduleHasContent(key, event));
  $('#layer-count').textContent = `上屏 ${visible.length} / ${available.length}`;
  updateRegion('#module-list', moduleList(state, event, layoutKey, online));
  initThemedSelects($('#module-list'));
  return visible;
}

function renderLayout() {
  const scope = layoutScope();
  const draft = layoutDrafts.get(scope);
  const layout = { ...state.modules[layoutKey], ...draft?.patch };
  const corner = draft?.patch.corner ?? state.meet.corner;
  if (renderedLayoutScope !== scope) {
    renderedLayoutScope = scope;
    layoutPane.innerHTML = inspector({ layout, key: layoutKey, corner, collapsed: collapsedSections });
  } else {
    syncLayoutForm(layout, corner);
  }
  const status = $('#layout-status');
  const message = draft?.error || (draft ? (draft.saving ? '保存中…' : '待保存') : online ? '布局已同步' : '等待连接');
  if (status.textContent !== message) status.textContent = message;
  status.classList.toggle('error', Boolean(draft?.error));
  const retry = layoutPane.querySelector('[data-action="layout-retry"]');
  retry.hidden = !draft?.error;
  retry.disabled = !online;
}

function render() {
  const event = activeEvent(state);
  if (!applicable(layoutKey, event)) layoutKey = 'brand';
  renderEventPicker();
  renderRoster();
  renderHeader(event, renderLayers(event));
  renderLayout();
  renderFocus();
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
  rosterView.page = Math.floor(rosterView.anchor / limit);
  rosterView.limit = limit;
  if (state) renderRoster();
});
paginationObserver.observe(rosterContainer);

function selectModule(key) {
  if (!applicable(key, activeEvent(state))) return;
  flushLayout();
  layoutKey = key;
  setWorkspace('output');
  renderLayers(activeEvent(state));
  renderLayout();
  renderFocus();
  tellPreview();
  setMonitor('edit', true);
}

function layoutScope() {
  return JSON.stringify([state.activeEventId, layoutKey]);
}

function updateRange(range, number) {
  const min = Number(range.min);
  const max = Number(range.max);
  range.style.setProperty('--range-fill', `${Math.round((Number(range.value) - min) / Math.max(1, max - min) * 100)}%`);
  if (number !== document.activeElement) number.value = range.value;
}

function syncLayoutForm(layout, corner) {
  const form = $('#layout-form');
  const focus = document.activeElement;
  const bounds = moduleBounds(layoutKey, layout.scale);
  const values = { ...layout, ...modulePosition(layoutKey, layout), corner };
  for (const range of form.querySelectorAll('[data-range]')) {
    const number = form.querySelector(`[data-number="${range.name}"]`);
    if (Object.hasOwn(bounds, range.name)) range.max = number.max = bounds[range.name];
    if (focus !== range && focus !== number) range.value = values[range.name];
    updateRange(range, number);
  }
  for (const name of ['enter', 'exit', 'corner']) {
    const input = form.elements[name];
    if (input && input !== focus) input.value = values[name] ?? '';
  }
}

function queueLayout(changes, immediate = false) {
  const id = layoutScope();
  const draft = layoutDrafts.get(id) ?? { id, eventId: state.activeEventId, key: layoutKey, patch: {} };
  for (const [name, value] of Object.entries(changes)) {
    const saved = name === 'corner' ? state.meet.corner : state.modules[draft.key][name];
    if (!draft.saving && value === saved) delete draft.patch[name];
    else draft.patch[name] = value;
  }
  clearTimeout(draft.timer);
  draft.timer = undefined;
  draft.error = '';
  if (!Object.keys(draft.patch).length) layoutDrafts.delete(id);
  else {
    layoutDrafts.set(id, draft);
    if (immediate) void saveLayout(draft);
    else draft.timer = setTimeout(() => saveLayout(draft), 260);
  }
  renderLayout();
}

async function saveLayout(draft) {
  clearTimeout(draft.timer);
  draft.timer = undefined;
  if (draft.saving) return;
  if (draft.eventId !== state.activeEventId || !online) {
    draft.error = draft.eventId !== state.activeEventId ? '切回原赛事后可重试' : '连接恢复后可重试';
    renderLayout();
    return;
  }
  const patch = { ...draft.patch };
  draft.saving = true;
  draft.error = '';
  renderLayout();
  try {
    await run('module:save', { eventId: draft.eventId, key: draft.key, patch });
    for (const [name, value] of Object.entries(patch)) {
      if (draft.patch[name] === value) delete draft.patch[name];
    }
  } catch (error) {
    draft.error = error.message;
    if (draft.id === layoutScope()) tellPreview({ resetPosition: true });
  } finally {
    draft.saving = false;
    const remaining = Object.keys(draft.patch).length;
    if (!remaining) layoutDrafts.delete(draft.id);
    renderLayout();
    if (remaining && !draft.timer && !draft.error) void saveLayout(draft);
  }
}

function flushLayout() {
  if (!state) return;
  const draft = layoutDrafts.get(layoutScope());
  if (draft?.timer) void saveLayout(draft);
}

function layoutInput(target) {
  if (!target.matches('input, select')) return;
  const { form, dataset } = target;
  const name = dataset.number ?? target.name;
  if (dataset.range || dataset.number) {
    const range = form.elements[name];
    if (dataset.number) {
      if (!Number.isFinite(target.valueAsNumber)) return;
      range.value = target.value;
    }
    updateRange(range, form.querySelector(`[data-number="${name}"]`));
    queueLayout({ [name]: Number(range.value) });
  } else queueLayout({ [name]: target.value });
}

$('#module-list').addEventListener('change', async ({ target }) => {
  if (!target.matches('[data-lineup-page]') || !state) return;
  const eventId = target.dataset.eventId;
  const page = Number(target.value);
  try { await run('page:set', { eventId, key: 'lineup', page }); }
  catch (error) {
    if (state.activeEventId === eventId) target.value = String(state.pages.lineup);
    notify(error.message, true);
  }
});

document.querySelector('#roster-editor').addEventListener('submit', async (event) => {
  const form = event.target.closest('#roster-form');
  if (!form) return;
  event.preventDefault();
  const eventId = form.dataset.event;
  const current = activeEvent(state);
  if (current?.id !== eventId) return;
  const data = new FormData(form);
  const changes = Object.fromEntries([...data].map(([name, value]) => [name, String(value).trim()]));
  const fields = rosterSaveFields(current, undefined, changes);
  const existingIds = new Set(current.competitors.map(({ id }) => id));
  const submit = form.querySelector('[type="submit"]');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    await run('athlete:save', { eventId, fields }, '选手已添加');
    if (state.activeEventId === eventId) {
      addingAthlete = false;
      const index = roster(activeEvent(state)).findIndex(({ id }) => !existingIds.has(id));
      if (index >= 0) {
        rosterView.anchor = index;
        rosterView.page = Math.floor(index / rosterView.limit);
      }
      renderRoster();
    }
  } catch (error) {
    notify(error.message, true);
  } finally { submit.disabled = false; }
});

function rosterSaveFields(event, athlete, changes) {
  const overrides = { ...changes };
  const scoreName = ['result', 'attempts', 'jumps'].find((name) => Object.hasOwn(overrides, name));
  if (scoreName) {
    overrides.status = '';
    const status = overrides[scoreName].trim().toUpperCase();
    if (SPECIAL_RESULTS.has(status)) {
      delete overrides[scoreName];
      overrides.result = status;
    }
  }
  return athleteFields(event, athlete, overrides);
}

function saveRosterRow(id, eventId) {
  const key = `${eventId}:${id}`;
  const drafts = draftsFor(eventId);
  const pending = rosterSaves.get(key);
  if (pending) {
    return pending.promise.catch((error) => {
      const latest = drafts.get(id);
      const corrected = latest && Object.entries(pending.fields).some(([name, value]) => latest.fields[name] !== value);
      if (!corrected) throw error;
    }).then(() => saveRosterRow(id, eventId));
  }
  const event = state.events.find((row) => row.id === eventId);
  const athlete = event?.competitors.find((row) => row.id === id);
  const draft = drafts.get(id);
  if (!athlete || !draft) return Promise.resolve();
  const changes = { ...draft.fields };
  const fields = rosterSaveFields(event, athlete, changes);
  const job = run('athlete:save', { eventId, id, fields }).then(() => {
    const current = drafts.get(id);
    if (!current) return;
    for (const [name, value] of Object.entries(changes)) {
      if (current.fields[name] === value) delete current.fields[name];
    }
    current.error = '';
    if (!Object.keys(current.fields).length) drafts.delete(id);
  }).catch((error) => {
    if (drafts.has(id)) drafts.get(id).error = error.message;
    throw error;
  }).finally(() => {
    rosterSaves.delete(key);
    renderRoster();
  });
  rosterSaves.set(key, { promise: job, fields: changes });
  return job;
}

rosterContainer.addEventListener('input', ({ target }) => {
  if (!target.matches('[data-roster-field]')) return;
  const row = target.closest('[data-athlete]');
  const id = row.dataset.athlete;
  const drafts = draftsFor(row.dataset.event);
  const draft = drafts.get(id) ?? { fields: {}, error: '' };
  if (target.value.trim() === target.dataset.original && !rosterSaves.has(`${row.dataset.event}:${id}`)) delete draft.fields[target.name];
  else draft.fields[target.name] = target.value;
  draft.error = '';
  const dirty = Object.keys(draft.fields).length > 0;
  if (dirty) drafts.set(id, draft);
  else drafts.delete(id);
  const feedback = row.querySelector('.roster-feedback');
  feedback.textContent = dirty ? '待保存' : '';
  feedback.classList.remove('error');
  feedback.title = '';
});

rosterContainer.addEventListener('focusout', ({ target, relatedTarget }) => {
  if (refreshingRoster || !target.matches('[data-roster-field]')) return;
  const row = target.closest('[data-athlete]');
  if (row.contains(relatedTarget) && relatedTarget?.closest('[data-action]')) return;
  void saveRosterRow(row.dataset.athlete, row.dataset.event).catch((error) => notify(error.message, true));
});

const handlers = {
  async champion({ eventId, key }) {
    if (championBusy) return;
    championBusy = true;
    try {
      const event = activeEvent(state);
      const onAir = championAthlete(event)?.id === key && state.modules.results.visible;
      if (onAir) await run('module:save', { eventId, key: 'results', patch: { visible: false } }, '冠军已下屏');
      else {
        await saveRosterRow(key, eventId);
        await run('champion:publish', { eventId, id: key }, '冠军已上屏');
      }
    } finally {
      championBusy = false;
    }
  },
  'module-toggle'({ eventId, key }) {
    const visible = !(state.modules[key].visible && moduleHasContent(key, activeEvent(state)));
    if (visible && key === 'results') return run('champion:publish', { eventId });
    return run('module:save', { eventId, key, patch: { visible } });
  },
  page({ eventId, key, value }) { return run('page:set', { eventId, key, page: value }); },
  'roster-page'({ value }) {
    rosterView.page = value;
    rosterView.anchor = value * rosterView.limit;
    renderRoster();
  },
  'module-select'({ key }) { selectModule(key); },
  'layout-anchor'({ key }) {
    const scale = layoutDrafts.get(layoutScope())?.patch.scale ?? state.modules[layoutKey].scale;
    setMonitor('guides', true);
    queueLayout(safeAnchor(layoutKey, scale, key), true);
  },
  'layout-reset'() {
    const { visible, ...patch } = defaultLayout(layoutKey);
    queueLayout(patch, true);
  },
  'layout-retry'() { void saveLayout(layoutDrafts.get(layoutScope())); },
  'athlete-add'() { addingAthlete = true; renderRoster(); $('#roster-form [name="name"]')?.focus(); },
  'athlete-form-close'() { addingAthlete = false; renderRoster(); },
  async 'athlete-delete'({ eventId, key }) {
    if (rosterDeleting.has(key)) return;
    rosterDeleting.add(key);
    renderRoster();
    try {
      await rosterSaves.get(`${eventId}:${key}`)?.promise.catch(() => {});
      await run('athlete:delete', { eventId, id: key }, '已删除选手');
      draftsFor(eventId).delete(key);
    } finally {
      rosterDeleting.delete(key);
      renderRoster();
    }
  },
};

document.addEventListener('click', async (e) => {
  const node = e.target.closest('[data-action]');
  const action = node?.dataset.action;
  if (action === 'workspace') { setWorkspace(node.dataset.key); return; }
  if (!Object.hasOwn(handlers, action) || pendingButtons.has(node)) return;
  const { key, value } = node.dataset;
  if (!state) { notify('正在连接本机服务。', true); return; }
  const eventId = node.closest('[data-event]')?.dataset.event ?? state.activeEventId;
  try {
    const result = handlers[action]({ eventId, key, value: Number(value) });
    if (result instanceof Promise) {
      pendingButtons.add(node);
      node.setAttribute('aria-busy', 'true');
      try { await result; } finally {
        pendingButtons.delete(node);
        node.removeAttribute('aria-busy');
      }
    }
  } catch (error) { notify(error.message, true); }
});

// 方向键微调：聚焦监看（或预览 iframe）后按方向键移 1px，Shift 为 10px；连续按键合并保存
const ARROW_STEPS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const previewStage = document.querySelector('.preview-stage');
let nudgePatch = null;
let nudgeTimer;
let lastNudgeSave = 0;
async function flushNudge() {
  const patch = nudgePatch;
  nudgePatch = null;
  if (!patch) return;
  lastNudgeSave = Date.now();
  try { await run('module:save', { eventId: patch.eventId, key: patch.key, patch: { x: patch.x, y: patch.y } }); }
  catch (error) { notify(error.message, true); }
}
function nudge(dx, dy, step) {
  const key = layoutKey;
  const layout = state?.modules[key];
  if (!layout || !applicable(key, activeEvent(state))) return;
  const base = nudgePatch?.key === key && nudgePatch.eventId === state.activeEventId ? nudgePatch : modulePosition(key, layout);
  const bounds = moduleBounds(key, layout.scale);
  const x = clamp(base.x + dx * step, 0, bounds.x);
  const y = clamp(base.y + dy * step, 0, bounds.y);
  if (x === base.x && y === base.y && !nudgePatch) return;
  nudgePatch = { key, eventId: state.activeEventId, x, y };
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(flushNudge, Math.max(0, 140 - (Date.now() - lastNudgeSave)));
}

document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  const step = ARROW_STEPS[e.key];
  if (step && state && (document.activeElement === previewStage || document.activeElement === preview)) {
    e.preventDefault();
    nudge(step[0], step[1], e.shiftKey ? 10 : 1);
    return;
  }
  if (e.key === 'Enter' && e.target?.matches('[data-roster-field]')) {
    e.preventDefault();
    const row = e.target.closest('[data-athlete]');
    void saveRosterRow(row.dataset.athlete, row.dataset.event).catch((error) => notify(error.message, true));
    return;
  }
  if (e.key !== 'Escape') return;
  if (e.target?.matches('[data-roster-field]')) {
    const row = e.target.closest('[data-athlete]');
    draftsFor(row.dataset.event).delete(row.dataset.athlete);
    renderRoster();
  } else if (addingAthlete) { addingAthlete = false; renderRoster(); }
});

layoutPane.addEventListener('input', ({ target, isComposing }) => {
  if (!isComposing) layoutInput(target);
});
layoutPane.addEventListener('compositionend', ({ target }) => layoutInput(target));
layoutPane.addEventListener('submit', (event) => {
  event.preventDefault();
  flushLayout();
});
layoutPane.addEventListener('focusout', ({ target, relatedTarget }) => {
  if (target.dataset.number) target.value = target.form.elements[target.dataset.number].value;
  if (!layoutPane.contains(relatedTarget)) flushLayout();
  queueMicrotask(renderLayout);
});

layoutPane.addEventListener('toggle', (e) => {
  const section = e.target.closest?.('[data-section]');
  if (!section) return;
  const id = section.dataset.section;
  if (section.open) collapsedSections.delete(id);
  else collapsedSections.add(id);
}, true);

window.addEventListener('message', ({ source, origin, data }) => {
  if (origin !== location.origin || source !== preview.contentWindow) return;
  if (data?.type === 'preview:ready') tellPreview();
  if (data?.type === 'preview:connection') {
    const status = $('#monitor-status');
    status.hidden = data.ready;
    if (!data.ready) status.textContent = '监看正在重连 · 保留最后画面';
  }
  if (data?.type !== 'preview:move' || data.key !== layoutKey || data.eventId !== state?.activeEventId) return;
  queueLayout({ x: data.x, y: data.y }, true);
});
