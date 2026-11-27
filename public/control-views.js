import { escapeHtml as h } from './client.js';
import { medalIcon } from './medal.js';
import { MODULES, MOTIONS, OUTPUT_LAYERS, applicable, canRank, championAthlete, eventTitle, formatTime, formatMark, moduleBounds, moduleHasContent, modulePosition, moduleScaleLimit, lineupRoster, paginatedCount, roster, resultText } from './sport.js';

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
  down: 'M6 9l6 6 6-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.7M6.1 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.6-.7',
};

export function icon(key) {
  if (key === 'medal') return medalIcon();
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[key]}"/></svg>`;
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

export function pager(action, page, total) {
  if (total <= 1) return '';
  return `<button type="button" class="button compact" data-action="${action}" data-value="${page - 1}" aria-label="上一页" ${page <= 0 ? 'disabled' : ''}>${icon('left')}</button><span class="pager-position">${page + 1} / ${total}</span><button type="button" class="button compact" data-action="${action}" data-value="${page + 1}" aria-label="下一页" ${page >= total - 1 ? 'disabled' : ''}>${icon('right')}</button>`;
}

export function rosterTools(event) {
  if (!event) return '';
  return `${button('添加选手', { action: 'athlete-add', glyph: 'plus', small: true })}<span class="hint">回车或离开输入框保存</span>`;
}

const SPECIAL = ['DNS', 'DNF', 'DQ', 'NM'];

// 保存名单行时补齐号码、分组和试次等资料。
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

export function competitorPanel(event, { start, limit, drafts = new Map(), deleting = new Set(), resultsVisible = false, online }) {
  if (!event) return '<p class="empty-table">请先选择赛事。</p>';
  if (event.kind === 'match') return '<p class="empty-table">当前赛事为球赛，无选手名单。</p>';
  const rows = roster(event).slice(start, start + limit);
  if (!rows.length) return '<p class="empty-table">点「添加选手」填写姓名和班级。</p>';
  const championId = championAthlete(event)?.id;
  const head = `<thead><tr><th>姓名 / 班级</th><th class="result-col">成绩</th><th class="action-col">操作</th></tr></thead>`;
  const body = rows.map((athlete) => {
    const fields = athleteFields(event, athlete);
    const draft = drafts.get(athlete.id);
    const scoreName = event.kind === 'field' ? (event.schedule?.project === 'high-jump' ? 'jumps' : 'attempts') : 'result';
    if (SPECIAL.includes(athlete.status)) fields[scoreName] = athlete.status;
    const placeholder = scoreName === 'jumps' ? '130:O|135:X' : scoreName === 'attempts' ? '5.20|X|5.35' : '2:05.00';
    const feedback = draft?.error || (draft ? '待保存' : '');
    const input = (name, label, attrs = '') => `<input
      id="roster-${h(athlete.id)}-${name}" name="${name}" data-roster-field
      data-original="${h(fields[name] ?? '')}" value="${h(draft?.fields[name] ?? fields[name] ?? '')}"
      aria-label="${h(`${athlete.name} · ${label}`)}" aria-describedby="roster-feedback-${h(athlete.id)}"
      autocomplete="off" spellcheck="false" ${deleting.has(athlete.id) ? 'disabled' : ''} ${attrs}>`;
    const onAir = athlete.id === championId && resultsVisible;
    const blocked = !online || deleting.has(athlete.id);
    return `<tr data-athlete="${h(athlete.id)}" data-event="${h(event.id)}" class="${onAir ? 'champion-row' : ''}">
      <td class="roster-name">
        ${input('name', '姓名 / 队名', 'maxlength="30" placeholder="姓名 / 队名" required')}
        <div class="roster-profile">${input('team', '单位 / 班级', 'maxlength="35" placeholder="班级"')}${input('lane', event.kind === 'track' ? '道次' : '出场序', `type="number" min="1" max="999" placeholder="${event.kind === 'track' ? '道次' : '序'}"`)}</div>
      </td>
      <td class="table-result tabular">
        ${event.kind === 'ranking' ? `<span>${h(resultText(athlete, event))}</span>` : input(scoreName, scoreName === 'jumps' ? '跳高记录' : scoreName === 'attempts' ? '成绩 / 试次' : '成绩', `class="roster-score" maxlength="${scoreName === 'jumps' ? 1400 : scoreName === 'attempts' ? 128 : 24}" placeholder="${placeholder}"`)}
        <small id="roster-feedback-${h(athlete.id)}" class="roster-feedback${draft?.error ? ' error' : ''}" role="status" title="${h(draft?.error ?? '')}">${h(feedback)}</small>
      </td>
      <td class="row-actions"><div>${button(onAir ? '下屏' : '播冠军', { action: 'champion', key: athlete.id, glyph: 'medal', small: true, variant: onAir ? 'on-air' : '', pressed: onAir, disabled: blocked || !canRank(athlete), accessible: `${onAir ? '冠军下屏' : '播出冠军'} · ${athlete.name}` })}${button('删除', { action: 'athlete-delete', key: athlete.id, glyph: 'trash', small: true, iconOnly: true, disabled: blocked, accessible: `删除 ${athlete.name}` })}</div></td>
    </tr>`;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

export function athleteForm(event) {
  const track = event.kind === 'track';
  const field = event.kind === 'field';
  const jumps = event.schedule?.project === 'high-jump';
  return `<form id="roster-form" data-event="${h(event.id)}" novalidate>
    <div class="re-head"><strong>添加选手</strong></div>
    <div class="field-grid">
      <label class="field field-wide"><span>姓名 / 队名</span><input name="name" maxlength="30" placeholder="如 陆晨曦" required></label>
      <label class="field"><span>单位 / 班级</span><input name="team" maxlength="35" placeholder="高一3班"></label>
      <label class="field"><span>${track ? '道次' : '出场序'}</span><input name="lane" type="number" min="1" max="999" placeholder="—"></label>
      ${track ? '<label class="field field-wide"><span>成绩</span><input name="result" maxlength="24" placeholder="如 2:05.00" autocomplete="off" spellcheck="false"></label>'
        : field ? `<label class="field field-wide"><span>${jumps ? '跳高记录' : '成绩 / 试次'}</span><input name="${jumps ? 'jumps' : 'attempts'}" maxlength="${jumps ? 1400 : 128}" placeholder="${jumps ? '130:O|135:X' : '5.20 | 5.35 | X'}" autocomplete="off" spellcheck="false"></label>` : ''}
    </div>
    <div class="re-actions">
      <button type="button" class="ghost-button" data-action="athlete-form-close">取消</button>
      <button type="submit" class="button primary">添加选手</button>
    </div>
  </form>`;
}

function attemptsValue(athlete) {
  return (athlete.attempts ?? []).map((value) => (Number.isInteger(value) ? formatMark(value, false) : value)).join(' | ');
}

function jumpsValue(athlete) {
  return (athlete.jumps ?? []).map(({ height, outcome }) => `${height}:${outcome}`).join('|');
}

export function moduleList(state, event, selected, online) {
  return OUTPUT_LAYERS
    .map((key) => {
      const meta = MODULES[key];
      const layout = state.modules[key];
      const allowed = moduleHasContent(key, event);
      const live = layout.visible && allowed;
      const summary = moduleSummary(state, event, key);
      const page = state.pages[key] ?? 0;
      const pages = event && ['lineup', 'results'].includes(key) ? paginatedCount(event, key) : 1;
      const position = modulePosition(key, layout);
      return `<article class="module-card${live ? ' live' : ''}${selected === key ? ' active' : ''}">
        <button type="button" class="module-item" data-action="module-select" data-key="${key}" aria-pressed="${selected === key}" aria-label="调整${h(meta.title)}" ${applicable(key, event) ? '' : 'disabled'}>
          <span class="module-icon">${icon(meta.icon)}</span>
          <span class="module-main">
            <span class="module-title">${h(meta.title)}</span>
            <span class="module-summary" title="${h(summary)}">${h(summary)}</span>
          </span>
          <span class="module-map" aria-hidden="true"><span class="module-map-rect" style="left:${((position.x / 1920) * 100).toFixed(1)}%;top:${((position.y / 1080) * 100).toFixed(1)}%;width:${((meta.w * layout.scale / 100 / 1920) * 100).toFixed(1)}%;height:${((meta.h * layout.scale / 100 / 1080) * 100).toFixed(1)}%"></span></span>
        </button>
        <button type="button" class="module-toggle" data-action="module-toggle" data-key="${key}" aria-pressed="${live}" aria-label="${h(meta.title)}${live ? '下屏' : '上屏'}" ${online && allowed ? '' : 'disabled'}>${live ? '下屏' : '上屏'}</button>
        ${moduleControls(state, event, key, page, pages, allowed, online)}
      </article>`;
    })
    .join('');
}

function moduleControls(state, event, key, page, pages, allowed, online) {
  if (key === 'lineup' && allowed) return introControls(event, page, online);
  if (key === 'results' && allowed && pages > 1) {
    return `<div class="module-foot page-steps">${button('', { action: 'page', key: 'results', value: page - 1, glyph: 'left', iconOnly: true, small: true, disabled: !online || page <= 0, accessible: '上一页' })}<span>${page + 1} / ${pages}</span>${button('', { action: 'page', key: 'results', value: page + 1, glyph: 'right', iconOnly: true, small: true, disabled: !online || page >= pages - 1, accessible: '下一页' })}</div>`;
  }
  return '';
}

function introControls(event, page, online) {
  const rows = event ? lineupRoster(event) : [];
  if (!rows.length) return `<div class="module-foot intro-controls"><span class="hint">名单为空，先添加选手</span></div>`;
  const next = rows[page + 1];
  return `<div class="module-foot intro-controls">
    ${button('', { action: 'page', key: 'lineup', value: page - 1, glyph: 'left', iconOnly: true, small: true, disabled: !online || page <= 0, accessible: '上一位' })}
    <select id="lineup-picker" data-lineup-page="${page}" data-event-id="${h(event.id)}" aria-label="选择起跑介绍选手" ${online ? '' : 'disabled'}>${rows.map((athlete, index) => `<option value="${index}" ${index === page ? 'selected' : ''}>${index + 1}. ${h(athlete.name)}${athlete.lane ? ` · ${athlete.lane} 道` : ''}</option>`).join('')}</select>
    ${button('', { action: 'page', key: 'lineup', value: page + 1, glyph: 'right', iconOnly: true, small: true, disabled: !online || !next, accessible: '下一位' })}
    <span class="intro-next">${next ? `下一位 ${h(next.name)}` : '已是最后一位'}</span>
  </div>`;
}

function moduleSummary(state, event, key) {
  if (key === 'brand') return state.meet.corner || 'YZBTVS SPORT';
  if (!event) return '等待赛事';
  if (!applicable(key, event)) return '当前赛事不适用';
  if (key === 'event') return eventTitle(event);
  if (key === 'lineup') {
    const rows = lineupRoster(event);
    if (!rows.length) return '名单为空';
    return `${(state.pages.lineup ?? 0) + 1} / ${rows.length}`;
  }
  if (key === 'results') {
    const winner = championAthlete(event);
    return winner ? `${winner.name} · ${resultText(winner, event)}` : '请在名单选人';
  }
  return '';
}

export function inspector({ layout, key, corner, collapsed }) {
  const meta = MODULES[key];
  const position = modulePosition(key, layout);
  const bounds = moduleBounds(key, layout.scale);
  const limit = moduleScaleLimit(key);
  const percent = (value, min, max) => `${Math.round(((value - min) / Math.max(1, max - min)) * 100)}%`;
  const range = (name, label, value, min, max, unit) => `<div class="field field-wide"><span>${label}</span><span class="slider-line"><input type="range" class="range-input" data-range="${name}" name="${name}" min="${min}" max="${max}" value="${value}" style="--range-fill:${percent(value, min, max)}" aria-label="${label}"><span class="number-unit"><input type="number" data-number="${name}" min="${min}" max="${max}" value="${value}" aria-label="${label}数值"><span>${unit}</span></span></span></div>`;
  const section = (id, title, body) => `<details class="settings-section" data-section="${id}"${collapsed.has(id) ? '' : ' open'}>
      <summary><h3>${title}</h3></summary>
      <div class="section-body">${body}</div>
    </details>`;
  return `<form id="layout-form" class="layout-form" novalidate>
    <div class="inspector-head"><h3>${h(meta.title)}布局</h3>${button('恢复默认', { action: 'layout-reset', small: true, variant: 'subtle' })}</div>
    <div class="layout-feedback">
      <span id="layout-status" role="status"></span>
      <button type="button" class="button subtle compact" data-action="layout-retry" hidden>重试</button>
    </div>
    ${section('position', key === 'brand' ? '字标位置与大小' : '位置与大小', `
      <div class="anchor-buttons" role="group" aria-label="对齐安全区">
        ${Object.entries({ tl: '左上', tr: '右上', bl: '左下', br: '右下' }).map(([corner, title]) => button(title, { action: 'layout-anchor', key: corner, small: true, accessible: `对齐安全区${title}` })).join('')}
      </div>
      <div class="field-grid">
        ${range('x', '水平 X', position.x, 0, bounds.x, 'px')}
        ${range('y', '垂直 Y', position.y, 0, bounds.y, 'px')}
        ${range('scale', '整体大小', layout.scale, 35, limit, '%')}
      </div>`)}
    ${section('appearance', '外观', `
      <div class="field-grid">
        ${range('opacity', '不透明度', layout.opacity, 0, 100, '%')}
      </div>`)}
    ${section('motion', '出场 / 退场', `
      <div class="field-grid">
        <label class="field"><span>进场动画</span><select name="enter">${Object.entries(MOTIONS).map(([value, label]) => `<option value="${value}" ${layout.enter === value ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>
        <label class="field"><span>退场动画</span><select name="exit">${Object.entries(MOTIONS).map(([value, label]) => `<option value="${value}" ${layout.exit === value ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>
        ${range('duration', '动画时长', layout.duration, 80, 2000, 'ms')}
      </div>`)}
    ${key === 'brand' ? section('corner', '左下角角标', `
      <div class="field-grid">
        <label class="field field-wide"><span>校名</span><input name="corner" maxlength="12" value="${h(corner)}" placeholder="如 中山市烟洲中学"></label>
      </div>
      <p class="form-note">留空仅显示金色标志。</p>`) : ''}
  </form>`;
}
