import { escapeHtml as h } from './client.js';
import { MODULES, MOTIONS, applicable, eventTitle, formatTime, formatMark, moduleBounds, modulePosition, moduleScaleLimit, lineupRoster, roster, paginatedCount, resultText, standings } from './sport.js';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5L13 15l3-3 4 4M14.5 9.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 5.5a3 3 0 0 1 0 5.8M18 20a5.5 5.5 0 0 0-2.5-4.6',
  chart: 'M4 20h16M7 20v-6M12 20V8M17 20v-9',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  edit: 'M13 5l6 6-9 9H4v-6zM12 6l6 6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  close: 'M6 6l12 12M18 6L6 18',
  trophy: 'M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3',
  down: 'M6 9l6 6 6-6',
};

export function icon(key) {
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[key] ?? PATHS.trophy}"/></svg>`;
}

export function button(label, { action, key, value, glyph, variant = '', small = false, iconOnly = false, disabled = false, pressed, accessible } = {}) {
  const attrs = [`type="button"`, `class="button${variant ? ` ${variant}` : ''}${small ? ' compact' : ''}${iconOnly ? ' icon-button' : ''}"`];
  if (action) attrs.push(`data-action="${action}"`);
  if (key !== undefined) attrs.push(`data-key="${h(String(key))}"`);
  if (value !== undefined) attrs.push(`data-value="${h(String(value))}"`);
  if (disabled) attrs.push('disabled');
  if (pressed !== undefined) attrs.push(`aria-pressed="${pressed}"`);
  const title = accessible || (iconOnly ? label : '');
  if (title) attrs.push(`aria-label="${h(title)}"`, `title="${h(title)}"`);
  const body = `${glyph ? icon(glyph) : ''}${iconOnly ? '' : `<span>${h(label)}</span>`}`;
  return `<button ${attrs.join(' ')}>${body}</button>`;
}

export function pager(action, page, total, label = '翻页') {
  if (total <= 1) return '';
  return `<button type="button" class="button compact" data-action="${action}" data-value="${page - 1}" aria-label="上一页" ${page <= 0 ? 'disabled' : ''}>${icon('left')}</button><span class="pager-position">${page + 1} / ${total}</span><button type="button" class="button compact" data-action="${action}" data-value="${page + 1}" aria-label="下一页" ${page >= total - 1 ? 'disabled' : ''}>${icon('right')}</button>`;
}

export function rosterTools(event) {
  if (!event) return '';
  return button('添加选手', { action: 'athlete-add', glyph: 'plus', small: true });
}

const SPECIAL = ['DNS', 'DNF', 'DQ', 'NM'];

// 表单不再展示号码、分组、成绩、状态，编辑时要原样带上，避免服务端把这些数据清空
export function athleteFields(event, athlete, overrides = {}) {
  const fields = {
    name: athlete?.name ?? '', team: athlete?.team ?? '', lane: athlete?.lane ?? '',
    bib: athlete?.bib ?? '',
  };
  if (event.kind === 'track' && event.schedule) fields.heat = athlete?.heat ?? 1;
  if (event.schedule?.project === 'shuttle-50') {
    fields.boys = athlete?.boys ?? '';
    fields.girls = athlete?.girls ?? '';
  }
  if (event.kind === 'field') {
    fields.attempts = attemptsValue(athlete ?? {});
    if (event.schedule?.project === 'high-jump') fields.jumps = jumpsValue(athlete ?? {});
  } else if (athlete?.time != null) fields.result = formatTime(athlete.time, true);
  if (athlete && SPECIAL.includes(athlete.status)) fields.status = athlete.status;
  return { ...fields, ...overrides };
}

export function competitorPanel(event, { start, limit, pane }) {
  const rows = roster(event).slice(start, start + limit);
  if (!rows.length) return `<p class="empty-table">名单还是空的：点「添加选手」填一行，姓名和班级即可。</p>`;
  const championId = standings(event).find((row) => row.rank === 1)?.athlete.id;
  const head = `<thead><tr><th>姓名 / 班级</th><th class="result-col">成绩</th><th class="action-col">操作</th></tr></thead>`;
  const body = rows.map((athlete) => {
    const detail = athlete.team ?? '';
    const mark = event.kind === 'field' && event.schedule?.project !== 'high-jump' && athlete.attempts?.length
      ? athlete.attempts.map((value) => (Number.isInteger(value) ? formatMark(value) : value)).join(' ')
      : resultText(athlete, event);
    const isChampion = athlete.id === championId;
    const row = `<tr data-athlete="${athlete.id}"${isChampion ? ' class="champion-row"' : ''}>
      <td class="roster-name"><span>${h(athlete.name)}</span>${detail ? `<small>${h(detail)}</small>` : ''}</td>
      <td class="table-result tabular">${h(mark)}</td>
      <td class="row-actions">${button('冠军', { action: 'champion', key: athlete.id, glyph: 'trophy', small: true, variant: isChampion ? 'capture' : '', pressed: isChampion, accessible: `${isChampion ? '当前冠军' : '设为冠军'} · ${athlete.name}` })}${button('编辑', { action: 'athlete-edit', key: athlete.id, glyph: 'edit', small: true, iconOnly: true, accessible: `编辑 ${athlete.name}` })}</td>
    </tr>`;
    return row + (pane && pane.id === athlete.id ? championPaneRow(event, athlete, pane) : '');
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function championPaneRow(event, athlete, pane) {
  const jumps = event.kind === 'field' && event.schedule?.project === 'high-jump';
  const scoreField = !jumps && (event.kind === 'track' || event.kind === 'field');
  const current = event.kind === 'track' && athlete.time != null ? formatTime(athlete.time, true) : '';
  return `<tr class="champion-pane"><td colspan="3">
    <div class="champion-editor">
      <span class="champion-editor-name">冠军 · ${h(athlete.name)}</span>
      ${scoreField ? `<input id="champion-mark" placeholder="${event.kind === 'field' ? '试次，如 5.35 或 X' : '成绩，如 2:05.00'}" value="${h(current)}" autocomplete="off" spellcheck="false" inputmode="${event.kind === 'field' ? 'decimal' : 'text'}" aria-label="冠军成绩">` : ''}
      <div class="champion-editor-actions">
        ${scoreField ? button('推送', { action: 'champion-push', variant: 'primary' }) : ''}
        ${pane.pushed ? button('显示', { action: 'champion-show', variant: 'capture' }) : ''}
        ${button('', { action: 'champion-close', glyph: 'close', iconOnly: true, accessible: '收起成绩栏' })}
      </div>
    </div>
  </td></tr>`;
}

export function athleteForm(event, athlete) {
  const editing = Boolean(athlete);
  const profile = athlete ?? { lane: '', name: '', team: '' };
  const track = event.kind === 'track';
  return `<form id="roster-form" data-event="${event.id}" data-athlete="${athlete?.id ?? ''}" novalidate>
    <div class="re-head"><strong>${editing ? `编辑 ${h(athlete.name)}` : '添加选手'}</strong></div>
    <div class="field-grid">
      <label class="field field-wide"><span>姓名 / 队名</span><input name="name" maxlength="30" value="${h(profile.name ?? '')}" placeholder="如 陆晨曦" required></label>
      <label class="field"><span>单位 / 班级</span><input name="team" maxlength="35" value="${h(profile.team ?? '')}" placeholder="高一3班"></label>
      <label class="field"><span>${track ? '道次' : '出场序'}</span><input name="lane" type="number" min="1" max="999" value="${h(profile.lane ?? '')}" placeholder="—"></label>
    </div>
    <div class="re-actions">
      ${editing ? button('删除选手', { action: 'athlete-delete', key: athlete.id, variant: 'danger subtle', small: true }) : ''}
      <button type="button" class="ghost-button" data-action="athlete-form-close">取消</button>
      <button type="submit" class="button primary">${editing ? '保存修改' : '添加选手'}</button>
    </div>
  </form>`;
}

function attemptsValue(athlete) {
  return (athlete.attempts ?? []).map((value) => (Number.isInteger(value) ? formatMark(value, false) : value)).join(' | ');
}

function jumpsValue(athlete) {
  return (athlete.jumps ?? []).map(({ height, outcome }) => `${height}:${outcome}`).join('|');
}

export function moduleList(state, event, selected) {
  return Object.entries(MODULES)
    .filter(([key]) => !['teams', 'score'].includes(key))
    .map(([key, meta]) => {
      const layout = state.modules[key];
      const live = layout.visible && applicable(key, event);
      const allowed = applicable(key, event);
      const position = modulePosition(key, layout);
      const summary = moduleSummary(state, event, key);
      const page = state.pages[key] ?? 0;
      const pages = event && ['lineup', 'results'].includes(key) ? paginatedCount(event, key) : 1;
      return `<article class="module-card${live ? ' live' : ''}${selected === key ? ' active' : ''}">
        <span class="module-tally" aria-hidden="true"></span>
        <button type="button" class="module-toggle" data-action="module-toggle" data-key="${key}" aria-pressed="${layout.visible}" aria-label="${layout.visible ? '隐藏' : '显示'}${h(meta.title)}" title="${layout.visible ? '隐藏' : '显示'}${h(meta.title)}" ${allowed ? '' : 'disabled'}><span class="switch-track"><span class="switch-thumb"></span></span></button>
        <button type="button" class="module-item" data-action="module-select" data-key="${key}" aria-pressed="${selected === key}" aria-label="选中${h(meta.title)}">
          <span class="module-main">
            <span class="module-title">${h(meta.title)}</span>
            <span class="module-state">${live ? '画面中' : allowed ? '未显示' : '不适用'}</span>
            <span class="module-summary">${h(summary)}</span>
          </span>
          <span class="module-map" aria-hidden="true"><span class="module-map-rect" style="left:${((position.x / 1920) * 100).toFixed(1)}%;top:${((position.y / 1080) * 100).toFixed(1)}%;width:${((meta.w * layout.scale / 100 / 1920) * 100).toFixed(1)}%;height:${((meta.h * layout.scale / 100 / 1080) * 100).toFixed(1)}%"></span></span>
        </button>
        ${moduleControls(state, event, key, page, pages)}
        <span class="module-meta">${position.x} · ${position.y} · ${layout.scale}%</span>
      </article>`;
    })
    .join('');
}

function moduleControls(state, event, key, page, pages) {
  if (key === 'lineup' && event) {
    const rows = lineupRoster(event);
    const next = rows[page + 1] ?? null;
    if (!rows.length) return `<div class="module-foot intro-controls"><span class="hint">名单为空，先添加选手</span></div>`;
    return `<div class="module-foot intro-controls">
      <select data-lineup-page="${page}" data-event-id="${event.id}" aria-label="选择起跑介绍选手">${rows.map((athlete, index) => `<option value="${index}" ${index === page ? 'selected' : ''}>${index + 1}. ${h(athlete.name)}${athlete.bib ? ` · ${h(athlete.bib)}` : ''}</option>`).join('')}</select>
      <div class="intro-navigation">
        ${button('', { action: 'page', key: 'lineup', value: page - 1, glyph: 'left', iconOnly: true, small: true, disabled: page <= 0, accessible: '上一位' })}
        <span class="intro-next">${next ? `下一位 ${h(next.name)}` : '已是最后一位'}</span>
        ${button('', { action: 'page', key: 'lineup', value: page + 1, glyph: 'right', iconOnly: true, small: true, disabled: page >= pages - 1, accessible: '下一位' })}
      </div>
    </div>`;
  }
  if (key === 'results' && event && pages > 1) {
    return `<div class="module-foot page-steps">${button('', { action: 'page', key: 'results', value: page - 1, glyph: 'left', iconOnly: true, small: true, disabled: page <= 0, accessible: '上一页' })}<span>${page + 1} / ${pages}</span>${button('', { action: 'page', key: 'results', value: page + 1, glyph: 'right', iconOnly: true, small: true, disabled: page >= pages - 1, accessible: '下一页' })}</div>`;
  }
  return '';
}

function moduleSummary(state, event, key) {
  if (key === 'brand') return state.meet.subtitle || state.meet.title || '烟洲体育';
  if (!event) return '等待赛事';
  if (key === 'event') return eventTitle(event);
  if (key === 'lineup') {
    const rows = lineupRoster(event);
    if (!rows.length) return '名单为空';
    const athlete = rows[state.pages.lineup ?? 0] ?? rows[0];
    return `${(state.pages.lineup ?? 0) + 1} / ${rows.length} · ${athlete.name}${athlete.bib ? ` · ${athlete.bib}` : ''}`;
  }
  if (key === 'results') {
    const winner = standings(event).find((row) => row.rank === 1);
    return winner ? `冠军 ${winner.athlete.name} · ${resultText(winner.athlete, event)}` : '等待冠军';
  }
  return '';
}

export function inspector({ state, key, collapsed = new Set() }) {
  const meta = MODULES[key];
  const layout = state.modules[key];
  const position = modulePosition(key, layout);
  const bounds = moduleBounds(key, layout.scale);
  const limit = moduleScaleLimit(key);
  const percent = (value, min, max) => `${Math.round(((value - min) / (max - min)) * 100)}%`;
  const range = (name, label, value, min, max, unit) => `<label class="field"><span>${label}</span><span class="slider-line"><input type="range" class="range-input" data-range="${name}" name="${name}" min="${min}" max="${max}" value="${value}" style="--range-fill:${percent(value, min, max)}" aria-label="${label}"><span class="number-unit"><input type="number" data-number="${name}" min="${min}" max="${max}" value="${value}" aria-label="${label}数值"><span>${unit}</span></span></span></label>`;
  const section = (id, index, title, body, open) => `<details class="settings-section" data-section="${id}"${open ? ' open' : ''}>
      <summary><h3><span>${index}</span>${title}</h3></summary>
      <div class="section-body">${body}</div>
    </details>`;
  return `<form id="layout-form" class="layout-form" novalidate>
    <div class="card-head"><h3>布局微调</h3><span class="tag">${h(meta.title)}</span></div>
    <div class="visibility-row${layout.visible ? ' on' : ''}">
      <span class="visibility-copy"><strong>${layout.visible ? '画面中' : '未上屏'}</strong><small>${layout.visible ? '点击可立即隐藏' : '点击后出现在输出画面'}</small></span>
      <button type="button" class="switch" data-action="module-toggle" data-key="${key}" aria-pressed="${layout.visible}" aria-label="${layout.visible ? '隐藏' : '显示'}${h(meta.title)}"><span></span></button>
    </div>
    ${section('position', '01', '位置', `
      <div class="field-grid">
        ${range('x', '水平 X', position.x, 0, bounds.x, 'px')}
        ${range('y', '垂直 Y', position.y, 0, bounds.y, 'px')}
        <div class="field field-wide">${range('scale', '整体大小', layout.scale, 35, limit, '%')}</div>
      </div>`, !collapsed.has('position'))}
    ${section('appearance', '02', '外观', `
      <div class="field-grid">
        <div class="field field-wide">${range('opacity', '不透明度', layout.opacity, 0, 100, '%')}</div>
      </div>`, !collapsed.has('appearance'))}
    ${section('motion', '03', '出场 / 退场', `
      <div class="field-grid">
        <label class="field"><span>进场动画</span><select name="enter">${Object.entries(MOTIONS).map(([value, label]) => `<option value="${value}" ${layout.enter === value ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>
        <label class="field"><span>退场动画</span><select name="exit">${Object.entries(MOTIONS).map(([value, label]) => `<option value="${value}" ${layout.exit === value ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>
        <div class="field field-wide">${range('duration', '动画时长', layout.duration, 80, 2000, 'ms')}</div>
      </div>`, !collapsed.has('motion'))}
    <p class="form-note">所有设置调整后立即生效，也可以直接在监看里拖动已上屏的图层。</p>
  </form>`;
}
