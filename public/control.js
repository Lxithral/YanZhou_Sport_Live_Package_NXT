import { SportsClient, pageUrl } from './client.js';
import { Dialogs } from './control-dialogs.js';
import { athleteFields, athleteForm, competitorPanel, inspector, moduleList, pager, rosterTools } from './control-views.js';
import { onProgram } from './meet-program.js';
import { MODULES, activeEvent, applicable, clamp, eventTitle, formatTime, moduleBounds, standings } from './sport.js';

const $ = (selector) => document.querySelector(selector);
const workspace = $('.app-shell');
const canvas = document.querySelector('.monitor-canvas');
const preview = $('#preview');
const connection = $('#connection');
const layoutPane = $('#layout-inspector');
const rosterView = { page: 0, limit: 6 };
const HIDDEN_LAYERS = ['teams', 'score'];
const regionMarkup = new WeakMap();
let state;
let switchingFocus = false;
let renderedEventId;
let renderedRosterId;
let rosterEditing = null;
let championPane = null; // { id, pushed } 冠军成绩填写栏
let toastTimer;
let layoutKey = 'brand';
// 布局面板默认只展开「位置」，外观与出场/退场收起，避免面板过长
const collapsedSections = new Set(['appearance', 'motion']);
let layoutDirty = false;
let layoutModel;
let layoutSaveTimer;

function setWorkspace(key) {
  workspace.dataset.workspace = key;
  document.querySelectorAll('.mobile-nav button').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.key === key)));
}

function tellPreview(extra = {}) {
  preview.contentWindow?.postMessage({ type: 'preview:settings', editKey: layoutKey, ...extra }, location.origin);
}
preview.addEventListener('load', () => tellPreview());
preview.src = pageUrl('overlay', { preview: '1' });

const client = new SportsClient({
  role: 'control',
  onState(next) { state = next; render(); },
  onConnection(ready) {
    connection.classList.toggle('connection--online', ready);
    connection.textContent = ready ? '本机已连接' : '正在重连';
  },
});

const dialogs = new Dialogs(async (action, args) => { await run(action, args); });

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
  node.innerHTML = markup;
  regionMarkup.set(node, markup);
  if (action) {
    const targets = [...node.querySelectorAll(`[data-action="${CSS.escape(action)}"]:not(:disabled)`)];
    const sameKey = targets.filter((entry) => entry.dataset.key === focus.dataset.key);
    const next = sameKey.find((entry) => entry.dataset.value === focus.dataset.value) ?? sameKey[0];
    next?.focus({ preventScroll: true });
  } else if (focusId) node.querySelector(`#${CSS.escape(focusId)}`)?.focus({ preventScroll: true });
}

// 监看画布按 16:9 自适应
new ResizeObserver(([entry]) => {
  const width = Math.max(0, Math.min(entry.contentRect.width, entry.contentRect.height * 16 / 9));
  canvas.style.width = `${width.toFixed(1)}px`;
  canvas.style.height = `${(width * 9 / 16).toFixed(1)}px`;
}).observe(document.querySelector('.preview-stage'));

function renderHeader(event) {
  $('#live-event').textContent = event ? eventTitle(event) : '未选择赛事';
  const live = event ? state.modules.results.visible || state.modules.lineup.visible || state.modules.event.visible : false;
  const bits = [];
  if (event) bits.push(`${event.competitors.length} 位选手`);
  bits.push(live ? '画面进行中' : '待机');
  $('#live-meta').textContent = bits.join(' · ');
  document.body.dataset.live = String(Boolean(event && live));
}

function renderRoster() {
  const event = activeEvent(state);
  if (event?.id !== renderedRosterId) {
    rosterView.page = 0;
    if (rosterEditing === 'new') rosterEditing = null;
    championPane = null;
  }
  renderedRosterId = event?.id;
  if (championPane && !event?.competitors.some((athlete) => athlete.id === championPane.id)) championPane = null;
  const total = Math.max(1, Math.ceil((event?.competitors.length ?? 0) / rosterView.limit));
  rosterView.page = clamp(rosterView.page, 0, total - 1);
  updateRegion('#roster-tools', rosterTools(event));
  const editingAthlete = event?.competitors.find((athlete) => athlete.id === rosterEditing);
  updateRegion('#roster-editor', event && (rosterEditing === 'new' || editingAthlete) ? athleteForm(event, editingAthlete) : '');
  updateRegion('#roster-rows', competitorPanel(event, { start: rosterView.page * rosterView.limit, limit: rosterView.limit, pane: championPane }));
  updateRegion('#roster-pager', total > 1 ? pager('roster-page', rosterView.page, total, '选手名单') : '');
  $('#roster-rows').style.setProperty('--roster-count', String(event?.competitors.length ?? 0));
  if (rosterEditing && !$('#roster-editor form')) rosterEditing = null;
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
  const available = Object.keys(MODULES).filter((key) => !HIDDEN_LAYERS.includes(key) && applicable(key, event));
  const visible = available.filter((key) => state.modules[key].visible).length;
  $('#layer-count').textContent = `上屏 ${visible} / ${available.length}`;
  updateRegion('#module-list', moduleList(state, event, layoutKey));
  initThemedSelects($('#module-list'));
}

function renderLayout() {
  if (!layoutDirty && !layoutPane.contains(document.activeElement)) {
    const model = JSON.stringify([layoutKey, state.modules[layoutKey], activeEvent(state)?.kind]);
    if (layoutModel !== model) {
      layoutPane.innerHTML = inspector({ state, key: layoutKey, collapsed: collapsedSections });
      layoutModel = model;
    }
  }
}

function render() {
  const event = activeEvent(state);
  const program = state.events.filter(onProgram);
  if (!switchingFocus && program.length && event && !onProgram(event)) {
    switchingFocus = true;
    run('event:select', { eventId: program[0].id }).catch(() => {}).finally(() => { switchingFocus = false; });
    return;
  }
  if (renderedEventId !== state.activeEventId) {
    renderedEventId = state.activeEventId;
    layoutDirty = false;
    layoutModel = undefined;
  }
  if (!applicable(layoutKey, event)) { layoutKey = 'brand'; layoutDirty = false; }
  renderHeader(event);
  renderRoster();
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

// 布局设置不再需要「应用」按钮：停止调整 260ms 后自动保存生效
function applyLayout() {
  const form = $('#layout-form');
  if (!form || !state) return;
  const data = new FormData(form);
  const patch = Object.fromEntries(['x', 'y', 'scale', 'opacity', 'enter', 'exit', 'duration'].map((attr) => [attr, data.get(attr)]));
  const eventId = state.activeEventId;
  const key = layoutKey;
  const cornerInput = form.querySelector('[name="corner"]');
  const meet = state.meet;
  const saveCorner = cornerInput && meet
    ? run('meet:save', { eventId, title: meet.title, subtitle: meet.subtitle, accent: meet.accent, corner: cornerInput.value })
    : Promise.resolve();
  saveCorner.then(() => run('module:save', { eventId, key, patch })).then(() => {
    if (state.activeEventId !== eventId || layoutKey !== key) return;
    layoutDirty = false;
    layoutModel = undefined;
    renderLayout();
  }).catch((error) => notify(error.message, true));
}

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

document.querySelector('#roster-editor').addEventListener('submit', async (event) => {
  const form = event.target.closest('#roster-form');
  if (!form) return;
  event.preventDefault();
  const eventId = form.dataset.event;
  const id = form.dataset.athlete;
  const current = activeEvent(state);
  const existing = id ? current?.competitors.find((athlete) => athlete.id === id) : undefined;
  const data = new FormData(form);
  const picks = (name) => String(data.get(name) ?? '').trim();
  // 表单只填姓名、班级、道次、成绩，其余数据原样保留
  const fields = athleteFields(current, existing, { name: picks('name'), team: picks('team'), lane: picks('lane') });
  if (data.has('result')) {
    const typed = picks('result');
    const currentResult = existing?.time != null ? formatTime(existing.time, true) : '';
    if (typed !== currentResult) { fields.result = typed; fields.status = ''; }
  }
  if (data.has('attempts')) fields.attempts = picks('attempts');
  try {
    await run('athlete:save', { eventId, id: id || undefined, fields }, id ? '选手已更新' : '选手已添加');
    rosterEditing = null;
    renderRoster();
  } catch (error) {
    notify(error.message, true);
  }
});

// 冠军流程：点冠军 → 行下展开成绩栏 → 填成绩推送 → 点显示上屏
async function pushChampion() {
  if (!championPane || !state) return;
  const event = activeEvent(state);
  const athlete = event?.competitors.find((row) => row.id === championPane.id);
  if (!athlete) return;
  const input = $('#champion-mark');
  const value = input ? input.value.trim() : '';
  if (!value) { notify('先填成绩再推送。', true); input?.focus(); return; }
  try {
    if (event.kind === 'field') {
      await run('athlete:attempt', { eventId: event.id, id: athlete.id, value, index: (athlete.attempts ?? []).length }, '成绩已推送');
    } else {
      await run('athlete:save', { eventId: event.id, id: athlete.id, fields: athleteFields(event, athlete, { result: value, status: '' }) }, '成绩已推送');
    }
    championPane = { id: athlete.id, pushed: true };
  } catch (error) {
    notify(error.message, true);
    return;
  }
  renderRoster();
  $('#champion-mark')?.focus();
}

const handlers = {
  workspace({ key }) { setWorkspace(key); },
  champion({ event, eventId, key }) {
    if (championPane?.id === key) { championPane = null; renderRoster(); return; }
    const alreadyChampion = standings(event).find((row) => row.rank === 1)?.athlete.id === key;
    const job = alreadyChampion ? Promise.resolve() : run('rank:champion', { eventId, id: key });
    return job.then(() => {
      const athlete = event.competitors.find((row) => row.id === key);
      const hasScore = event.kind === 'field' ? (athlete?.attempts ?? []).some(Number.isInteger) : athlete?.time != null;
      championPane = { id: key, pushed: Boolean(hasScore) };
      renderRoster();
    });
  },
  'champion-push'() { return pushChampion(); },
  'champion-show'({ eventId }) {
    return run('module:save', { eventId, key: 'results', patch: { visible: true } }, '冠军已上屏').then(() => {
      championPane = null;
      renderRoster();
    });
  },
  'champion-close'() { championPane = null; renderRoster(); },
  'module-toggle'({ key }) {
    return run('module:save', { eventId: state.activeEventId, key, patch: { visible: !state.modules[key].visible } });
  },
  page({ key, value }) { return run('page:set', { eventId: state.activeEventId, key, page: value }); },
  'roster-page'({ value }) { rosterView.page = value; renderRoster(); },
  'module-select'({ key }) { selectModule(key); },
  'athlete-add'() { rosterEditing = 'new'; renderRoster(); },
  'athlete-edit'({ key }) { rosterEditing = key; championPane = null; renderRoster(); },
  'athlete-form-close'() { rosterEditing = null; renderRoster(); },
  'athlete-delete'({ event, athlete }) {
    return dialogs.confirm('删除选手', `将从名单中删除 ${athlete.name}，成绩一起移除。`, '删除', async () => {
      await run('athlete:delete', { eventId: event.id, id: athlete.id }, '已删除选手');
      rosterEditing = null;
      championPane = null;
      renderRoster();
    });
  },
};

document.addEventListener('click', async (e) => {
  const node = e.target.closest('[data-action]');
  const action = node?.dataset.action;
  if (!Object.hasOwn(handlers, action)) return;
  const { key, value } = node.dataset;
  if (!state) { notify('正在连接本机服务。', true); return; }
  const event = activeEvent(state);
  try {
    const result = handlers[action]({ event, eventId: event?.id, key, value: Number(value), athlete: event?.competitors.find((athlete) => athlete.id === key) });
    if (result instanceof Promise) {
      node.disabled = true;
      try { await result; } finally { node.disabled = false; }
    }
  } catch (error) { notify(error.message, true); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target?.name === 'corner') {
    e.preventDefault();
    clearTimeout(layoutSaveTimer);
    applyLayout();
    return;
  }
  if (e.key === 'Enter' && e.target?.id === 'champion-mark') {
    e.preventDefault();
    void pushChampion();
    return;
  }
  if (e.key !== 'Escape') return;
  if (rosterEditing) { rosterEditing = null; renderRoster(); return; }
  if (championPane) { championPane = null; renderRoster(); }
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
  const number = e.target.closest?.('[data-number]');
  if (number) {
    const form = number.form;
    const rangeInput = form?.querySelector(`[data-range="${number.dataset.number}"]`);
    if (rangeInput && number.value !== '') {
      rangeInput.value = number.value;
      rangeInput.style.setProperty('--range-fill', `${Math.round((Number(rangeInput.value) - Number(rangeInput.min)) / Math.max(1, Number(rangeInput.max) - Number(rangeInput.min)) * 100)}%`);
      if (number.dataset.number === 'scale') updatePositionBounds(form);
    }
  }
  if (e.target.name === 'scale' && e.target.form) updatePositionBounds(e.target.form);
  layoutDirty = true;
  clearTimeout(layoutSaveTimer);
  layoutSaveTimer = setTimeout(applyLayout, 260);
});

layoutPane.addEventListener('focusout', () => {
  clearTimeout(layoutSaveTimer);
  applyLayout();
  renderLayout();
});

layoutPane.addEventListener('toggle', (e) => {
  const section = e.target.closest?.('[data-section]');
  if (!section) return;
  const id = section.dataset.section;
  if (section.open) collapsedSections.delete(id);
  else collapsedSections.add(id);
}, true);

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
