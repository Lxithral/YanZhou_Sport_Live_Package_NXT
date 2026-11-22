import { escapeHtml as h } from './client.js';
import { MODULES, DIVISIONS, GRADES, MOTIONS, RESULT_STATUS, applicable, eventTitle, formatTime, formatMark, moduleBounds, modulePosition, moduleScaleLimit, lineupRoster, roster, paginatedCount, jumpHeight, resultText, standings, relayRegistration } from './sport.js';
import { compareSchedule } from './meet-program.js';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  link: 'M9 15l6-6M8 13H5.5A3.5 3.5 0 1 1 9 9.5M16 11h2.5A3.5 3.5 0 1 0 15 14.5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5L13 15l3-3 4 4M14.5 9.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  timer: 'M12 8v5l3 2M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 1.5h6',
  score: 'M4 19V5h16v14zM8 15v-4M12 15V7M16 15v-6',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M17 5.5a3 3 0 0 1 0 5.8M18 20a5.5 5.5 0 0 0-2.5-4.6',
  chart: 'M4 20h16M7 20v-6M12 20V8M17 20v-9',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0',
  notice: 'M4 10v4h4l6 4V6L8 10zM18 9a4 4 0 0 1 0 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.7M6.1 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 3.6-.7',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  screen: 'M3 5h18v11H3zM9 20h6M12 16v4',
  layout: 'M4 4h16v16H4zM4 10h16M10 10v10',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  start: 'M7 4l13 8-13 8z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M4 10a8 8 0 1 1 2.3 6.7M3 4v6h6',
  stop: 'M6 6h12v12H6z',
  edit: 'M13 5l6 6-9 9H4v-6zM12 6l6 6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  close: 'M6 6l12 12M18 6L6 18',
  flag: 'M5 21V4M5 4h11l-1.5 4L16 12H5',
  check: 'M4 12.5l5 5L20 6.5',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  down: 'M6 9l6 6 6-6',
};

export function icon(key) {
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[key] ?? PATHS.flag}"/></svg>`;
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

export function currentEventPicker(events, selected) {
  const id = typeof selected === 'string' ? selected : selected?.id;
  const has = events.some((event) => event.id === id);
  return `<label class="current-picker"><span>当前赛事</span><select id="active-event" aria-label="当前赛事">${has ? '' : '<option value="">未选择赛事</option>'}${options(eventOptions(events), id)}</select></label>`;
}

function eventOptions(events) {
  const scheduled = events.filter((event) => event.schedule).toSorted(compareSchedule);
  const others = events.filter((event) => !event.schedule);
  const list = [];
  if (scheduled.length) {
    list.push({ label: '本届校运会', children: scheduled });
  }
  if (others.length) {
    list.push({ label: '其他赛事', children: others });
  }
  return list.flatMap(({ label, children }) => [
    { label, disabled: true, group: true },
    ...children.map((event) => ({ value: event.id, label: `${eventTitle(event)}${event.schedule ? ` · ${event.schedule.start.slice(5, 10).replace('-', '/')} ${event.schedule.start.slice(11, 16)}` : ''}` })),
  ]);
}

export function divisionPicker(events, selected) {
  const counts = new Map();
  for (const event of events) counts.set(event.division, (counts.get(event.division) ?? 0) + 1);
  return Object.entries(DIVISIONS)
    .filter(([key]) => key !== 'open' || counts.get(key))
    .map(([key, label]) => `<button type="button" data-action="division" data-key="${key}" aria-pressed="${selected === key}">${h(label)}${counts.get(key) ? ` <span class="badge">${counts.get(key)}</span>` : ''}</button>`)
    .join('');
}

export function rosterPicker(events, activeId, selected) {
  const rows = events.filter((event) => event.kind !== 'match').toSorted(compareSchedule);
  const first = !selected ? '跟随当前赛事' : '';
  return `<label class="prep-label"><span>名单赛事</span><select id="prep-event" aria-label="名单赛事"><option value="">${first || '跟随当前赛事'}</option>${rows.map((event) => `<option value="${event.id}" ${event.id === selected ? 'selected' : ''}>${h(eventTitle(event))}</option>`).join('')}</select></label>`;
}

export function pager(action, page, total, label = '翻页') {
  if (total <= 1) return '';
  return `<button type="button" class="button compact" data-action="${action}" data-value="${page - 1}" aria-label="上一页" ${page <= 0 ? 'disabled' : ''}>${icon('left')}</button><span class="pager-position">${page + 1} / ${total}</span><button type="button" class="button compact" data-action="${action}" data-value="${page + 1}" aria-label="下一页" ${page >= total - 1 ? 'disabled' : ''}>${icon('right')}</button>`;
}

export function operations(event) {
  if (!event) return `<div class="operations-panel no-event"><span class="hint">${h('先选择一场赛事，这里会出现记分和操作按钮。')}</span></div>`;
  if (event.kind === 'track') return '';
  if (event.kind === 'ranking') return `<div class="operations-panel"><span class="hint">团体项目，赛制待定。</span></div>`;
  if (event.kind === 'match') {
    return `<div class="operations-panel operations-panel--match">${ballPanel(event)}</div>`;
  }
  const best = Math.max(0, ...event.competitors.flatMap((athlete) => athlete.attempts ?? []).filter(Number.isInteger));
  const jumps = event.schedule?.project === 'high-jump';
  return `<div class="operations-panel operations-panel--field">
    <div class="field-summary">
      <span>最佳成绩 <b>${best ? h(formatMark(best)) : '—'}</b></span>
      ${jumps ? `<span>横杆 <b>${jumpHeight(event)}</b><small> cm</small></span><button type="button" class="button capture" data-action="jump-raise">升杆</button>` : `<span>试次上限 <b>${event.competitors.reduce((max, athlete) => Math.max(max, (athlete.attempts ?? []).length), 0)}</b><small> / 12</small></span>`}
      ${jumps ? '' : `<span class="hint">在名次表点「录入」逐次记录试次</span>`}
    </div>
  </div>`;
}

function ballPanel(event) {
  const match = event.match ?? { home: 0, away: 0, period: 1 };
  const half = (match.period ?? 1) === 1;
  const steps = half ? [1] : [1, 2, 3];
  const team = (side, label, score) => `<div class="ball-team"><div><strong class="tabular">${score ?? 0}</strong><span>${h(label)}</span></div><div class="score-actions">${steps.map((step) => button(`+${step}`, { action: 'score', key: side, value: step, small: true })).join('')}${button('−1', { action: 'score', key: side, value: -1, small: true })}</div></div>`;
  const periodLabel = (match.period ?? 1) === 1 ? '上半场' : match.period === 2 ? '下半场' : `加时 ${match.period - 2}`;
  return `<div class="ball-panel"><div class="ball-grid">${team('home', event.home ?? '主队', match.home)}${team('away', event.away ?? '客队', match.away)}</div><div class="period-actions"><span class="period-label">${h(periodLabel)}</span>${button('−1', { action: 'period', value: -1, small: true })}${button('+1', { action: 'period', value: 1, small: true })}</div></div>`;
}

export function rosterTools(event) {
  if (!event) return '';
  if (event.kind === 'match') return button('比赛比分', { action: 'meet', glyph: 'score', small: true });
  return button('添加选手', { action: 'athlete-add', glyph: 'plus', small: true });
}

export function competitorPanel(event, { start, limit, onAir }) {
  const rows = roster(event).slice(start, start + limit);
  if (!rows.length) return `<p class="empty-table">名单还是空的：点「添加选手」填一行，号码和成绩都能直接贴上。</p>`;
  const head = `<thead><tr><th class="lane-col">${h(event.kind === 'track' ? '道次' : '序')}</th><th class="bib-col">号码</th><th>姓名 / 单位</th><th class="result-col">成绩</th><th class="action-col">操作</th></tr></thead>`;
  const body = rows.map((athlete) => {
    const registration = relayRegistration(athlete);
    const detail = [athlete.team, athlete.heat && event.kind === 'track' ? `第 ${athlete.heat} 组` : '', registration !== '待核验' ? registration : ''].filter(Boolean).join(' · ');
    const mark = event.kind === 'field' && event.schedule?.project !== 'high-jump' && athlete.attempts?.length
      ? athlete.attempts.map((value) => (Number.isInteger(value) ? formatMark(value) : value)).join(' ')
      : resultText(athlete, event);
    return `<tr data-athlete="${athlete.id}">
      <td class="table-lane tabular">${athlete.lane ?? '—'}</td>
      <td class="table-bib tabular">${h(athlete.bib || '—')}</td>
      <td class="roster-name"><span>${h(athlete.name)}</span>${detail ? `<small>${h(detail)}</small>` : ''}</td>
      <td class="table-result tabular">${h(mark)}</td>
      <td class="row-actions">${button('编辑', { action: 'athlete-edit', key: athlete.id, glyph: 'edit', small: true, iconOnly: true, accessible: `编辑 ${athlete.name}` })}</td>
    </tr>`;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

export function athleteForm(event, athlete, open) {
  const editing = Boolean(athlete);
  const profile = athlete ?? { lane: '', bib: '', name: '', team: '', result: '', attempts: '', jumps: '', status: '', heat: '' };
  const track = event.kind === 'track';
  const jumps = event.schedule?.project === 'high-jump';
  const shuttle = event.schedule?.project === 'shuttle-50';
  const statuses = Object.entries(RESULT_STATUS).filter(([key]) => key !== 'ok');
  return `<form id="roster-form" data-event="${event.id}" data-athlete="${athlete?.id ?? ''}" novalidate>
    <div class="re-head"><strong>${editing ? `编辑 ${h(athlete.name)}` : '添加选手'}</strong><span class="hint">${track ? '径赛填成绩即可自动排名' : jumps ? '跳高按横杆逐次记录' : '田赛填试次，可用 X 表示犯规'}</span></div>
    <div class="field-grid">
      <label class="field field-wide"><span>姓名 / 队名</span><input name="name" maxlength="30" value="${h(profile.name ?? '')}" placeholder="如 陆晨曦" required></label>
      <label class="field"><span>号码</span><input name="bib" maxlength="14" value="${h(profile.bib ?? '')}" placeholder="0103"></label>
      <label class="field"><span>单位 / 班级</span><input name="team" maxlength="35" value="${h(profile.team ?? '')}" placeholder="高一3班"></label>
      <label class="field"><span>${track ? '道次' : '出场序'}</span><input name="lane" type="number" min="1" max="999" value="${h(profile.lane ?? '')}" placeholder="—"></label>
      ${track && event.schedule ? `<label class="field"><span>分组</span><input name="heat" type="number" min="1" max="32" value="${h(profile.heat ?? 1)}"></label>` : ''}
      ${shuttle ? `<label class="field"><span>男生人数</span><input name="boys" type="number" min="0" max="99" value="${h(profile.boys ?? '')}"></label><label class="field"><span>女生人数</span><input name="girls" type="number" min="0" max="99" value="${h(profile.girls ?? '')}"></label>` : ''}
      ${jumps ? '' : track
        ? `<label class="field field-wide"><span>成绩</span><input name="result" maxlength="24" value="${h(profile.time != null ? formatTime(profile.time, true) : '')}" placeholder="03:21.52"></label>`
        : `<label class="field field-wide"><span>试次</span><input name="attempts" maxlength="128" value="${h(attemptsValue(profile))}" placeholder="5.20 | 5.35 | X"></label>`}
      ${jumps ? `<label class="field field-wide"><span>跳高记录</span><input name="jumps" maxlength="1400" value="${h(jumpsValue(profile))}" placeholder="95:O|100:X|105:O"></label>` : ''}
      <label class="field"><span>状态</span><select name="status"><option value="">按成绩自动</option>${statuses.map(([key, label]) => `<option value="${key}" ${profile.status === key ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>
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
    const current = rows[page] ?? null;
    const next = rows[page + 1] ?? null;
    if (!rows.length) return `<div class="module-foot intro-controls"><span class="hint">名单为空，先去「备赛名单」添加选手</span></div>`;
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
    return winner ? `第一名 ${winner.athlete.name} · ${resultText(winner.athlete, event)}` : '等待第一名';
  }
  return '';
}

export function athleteFields(athlete) {
  const fields = { lane: athlete.lane ?? '', bib: athlete.bib ?? '', name: athlete.name, team: athlete.team ?? '' };
  if (athlete.heat != null) fields.heat = athlete.heat;
  if (athlete.boys != null) fields.boys = athlete.boys;
  if (athlete.girls != null) fields.girls = athlete.girls;
  return fields;
}

export function options(entries, selected) {
  const list = Array.isArray(entries) ? entries : Object.entries(entries ?? {});
  let html = '';
  for (const entry of list) {
    if (Array.isArray(entry)) {
      const [value, label] = entry;
      html += `<option value="${h(String(value ?? ''))}" ${String(value ?? '') === selected ? 'selected' : ''}>${h(String(label ?? ''))}</option>`;
      continue;
    }
    if (entry.group) continue;
    if (entry.children) {
      html += `<optgroup label="${h(entry.label)}">${entry.children.map((child) => `<option value="${h(child.value ?? child.id)}" ${(child.value ?? child.id) === selected ? 'selected' : ''}>${h(child.label ?? child.name)}</option>`).join('')}</optgroup>`;
      continue;
    }
    html += `<option value="${h(entry.value ?? '')}" ${(entry.value ?? '') === selected ? 'selected' : ''} ${entry.disabled ? 'disabled' : ''}>${h(entry.label)}</option>`;
  }
  return html;
}

export function input(label, name, value, attrs = '') {
  return `<label class="field"><span>${h(label)}</span><input name="${name}" value="${h(value ?? '')}" ${attrs}></label>`;
}

export function select(label, name, values, selected) {
  return `<label class="field"><span>${h(label)}</span><select name="${name}">${values.map(([value, text]) => `<option value="${h(value)}" ${value === selected ? 'selected' : ''}>${h(text)}</option>`).join('')}</select></label>`;
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
      </div>
      <div class="anchor-buttons">
        ${[['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']].map(([corner, label]) => button(label, { action: 'anchor', value: corner, small: true })).join('')}
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
    <div class="layout-buttons">
      <button type="button" class="ghost-button" data-action="layout-reset">恢复默认</button>
      <button type="submit" class="button primary">应用设置</button>
    </div>
    <p class="form-note">四角对齐会贴到安全区，也可以直接在监看里拖动已上屏的图层。</p>
  </form>`;
}
