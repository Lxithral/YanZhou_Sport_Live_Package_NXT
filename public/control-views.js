import { escapeHtml as h } from './client.js';
import {
  DIVISIONS, MODULES, MOTIONS, PHASES, applicable, canJump, checkpoints, clockPhase, eventTitle, formatMark, formatTime, heats, jumpHeight, moduleBounds,
  modulePosition, moduleScaleLimit, nextJumpHeight, paginatedCount, periodTitle, relayRegistration, resultText, roster, standings,
} from './sport.js';
import { compareSchedule } from './meet-program.js';

const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2m2 6a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2"/>',
  external: '<path d="M13 4h7v7m0-7-10 10M9 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m3 17 5-4 3 3 4-5 6 5"/>',
  list: '<path d="M3 5h18M3 12h18M3 19h12"/>',
  timer: '<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m6 1 2-2m-8 5v4l2 2"/>',
  score: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M12 5v14m-6-9h2v4H6m10-4h2v4h-2"/>',
  people: '<path d="M2.5 20v-2c0-3 2.5-5 5.5-5h2c3 0 5.5 2 5.5 5v2m2-7c2.5.4 4 2.5 4 5v2M15.5 4a3.5 3.5 0 0 1 0 7"/><circle cx="9" cy="7.5" r="3.5"/>',
  chart: '<path d="M3 21h18M6 17v-6m6 6V4m6 13V8"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-1a8 6 0 0 1 16 0v1"/>',
  notice: '<path d="M3 10v5h4l13 5V5l-13 5H3m4 5 2 6h3l-2-5"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  'eye-off': '<path d="M3 3l18 18M9 6.5a11 11 0 0 1 3-.5c6 0 10 6 10 6a17 17 0 0 1-3 3.1m-3 2.1a10 10 0 0 1-4 .8c-6 0-10-6-10-6a17 17 0 0 1 4-4.2"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  layout: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.5"/>',
  start: '<path d="M7 4l14 8-14 8Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="3.2"/>',
  reset: '<path d="M3 11a9 9 0 1 1 3 7m-3-7V5m0 6h6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/>',
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16m10-10 4 4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7m4-7v7"/>',
  upload: '<path d="M12 15V3M8 7l4-4 4 4M4 15v5h16v-5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  flag: '<path d="M5 22V3m0 1c4-4 9 4 14 0v11c-5 4-10-4-14 0"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
};

export function icon(key) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
}

export function button(label, { action, key, value, glyph, variant = '', small = false, iconOnly = false, disabled = false, pressed, accessible } = {}) {
  const classes = [iconOnly ? 'icon-button' : 'button', variant, small && 'compact'].filter(Boolean).join(' ');
  const attrs = [action && `data-action="${h(action)}"`, key !== undefined && `data-key="${h(key)}"`, value !== undefined && `data-value="${h(value)}"`,
    disabled && 'disabled', pressed !== undefined && `aria-pressed="${pressed}"`, (accessible || iconOnly) && `aria-label="${h(accessible || label)}" title="${h(accessible || label)}"`];
  return `<button class="${classes}" type="button" ${attrs.filter(Boolean).join(' ')}>${glyph ? icon(glyph) : ''}${iconOnly ? '' : h(label)}</button>`;
}

export function currentEventPicker(events, selected) {
  const division = events.find((event) => event.id === selected)?.division;
  const available = events.filter((event) => event.division === division);
  return `<label class="current-picker"><span>当前赛事</span><select id="active-event" aria-label="当前赛事" ${available.length ? '' : 'disabled'}>
    ${available.length ? eventOptions(available, selected) : '<option>请新建赛事</option>'}
  </select></label>`;
}

function eventOptions(events, selected, activeId) {
  const official = events.filter((event) => event.schedule).sort(compareSchedule);
  const extras = events.filter((event) => !event.schedule);
  const rows = (list) => list.map((event) => `<option value="${h(event.id)}" ${event.id === selected ? 'selected' : ''}>${h(eventTitle(event))}${event.id === activeId ? '（当前）' : ''}</option>`).join('');
  return `${official.length ? `<optgroup label="本届校运会">${rows(official)}</optgroup>` : ''}${extras.length ? `<optgroup label="其他赛事">${rows(extras)}</optgroup>` : ''}`;
}

export function divisionPicker(events, selected) {
  const current = events.find((event) => event.id === selected)?.division;
  return Object.entries(DIVISIONS).filter(([key]) => key !== 'open' || events.some((event) => event.division === key))
    .map(([key, title]) => button(title, { action: 'division', key, pressed: current === key, small: true })).join('');
}

export function rosterPicker(events, activeId, selected) {
  if (!events.length) return '';
  return `<label class="prep-label"><span>名单归属</span><select id="prep-event" name="prep-event">
    <option value="" ${selected ? '' : 'selected'}>跟随当前赛事</option>
    ${eventOptions(events, selected, activeId)}
  </select></label>`;
}

export function pager(action, page, total, label) {
  return `${button('上一页', { action, key: 'previous', value: page - 1, glyph: 'left', small: true, disabled: page === 0, accessible: `${label}上一页` })}
    <span class="pager-position" aria-live="polite">${page + 1} / ${total}</span>
    ${button('下一页', { action, key: 'next', value: page + 1, glyph: 'right', small: true, disabled: page + 1 >= total, accessible: `${label}下一页` })}`;
}

function clocks(event, phase) {
  const active = phase === 'running';
  const ready = phase === 'ready';
  const paused = phase === 'paused';
  const groups = event.kind === 'track' && event.schedule ? heats(event) : [];
  return `<div class="timing-row">
    <div class="time-readout"><strong id="current-time" aria-label="当前计时">${event.kind === 'match' && event.clockMode === 'down' ? `${event.periodMinutes}:00` : (event.kind === 'track' ? '00:00.00' : '00:00')}</strong><b class="phase phase--${phase}" id="current-phase">${PHASES[phase]}</b></div>
    ${groups.length > 1 ? `<label class="heat-picker">计时分组<select id="heat-select" ${active ? 'disabled' : ''}>${options(Object.fromEntries(groups.map((heat) => [heat, `第 ${heat} 组`])), event.heat ?? 1)}</select></label>` : ''}
    <div class="clock-actions">
      ${button(paused ? '继续计时' : '开始计时', { action: 'clock', key: paused ? 'resume' : 'start', glyph: 'start', variant: 'primary', disabled: !ready && !paused })}
      ${button('暂停', { action: 'clock', key: 'pause', glyph: 'pause', disabled: !active })}
      ${button('结束计时', { action: 'clock', key: 'finish', glyph: 'stop', disabled: !active && !paused })}
    </div>
  </div>`;
}

function splitProgress(event, phase) {
  const passes = event.splits.length;
  const distances = checkpoints(event);
  const next = distances[passes];
  const first = Math.max(0, Math.min(passes - 1, distances.length - 4));
  const points = distances.slice(first, first + 4);
  return `<div class="progress-row">
    <span>通过点${distances.length > 4 ? ` <small>${passes}/${distances.length}</small>` : ''}</span>
    <div class="checkpoints" aria-label="首位选手通过点">${points.map((distance, index) => {
      const i = first + index;
      return `<div class="checkpoint ${i < passes ? 'passed' : ''}" ${i === passes ? 'aria-current="step"' : ''}>
        <b>${distance} m</b>${i < passes ? `<small>${formatTime(event.splits[i].time)}</small>` : ''}</div>`;
    }).join('')}</div>
    ${button(next === event.distance ? '记录头名冲线' : '记录通过', { action: 'split', glyph: 'flag', small: true, variant: 'capture', disabled: phase !== 'running' || next === undefined })}
  </div>`;
}

function ballPanel(event, phase) {
  const teams = [['home', event.homeName], ['away', event.awayName]];
  return `<div class="ball-panel">
    <div class="ball-grid">${teams.map(([side, name]) => `<div class="ball-team ball-team--${side}">
        <div><span>${h(name)}</span><strong class="tabular">${event.score[side]}</strong></div>
        <div class="score-actions">${(event.periodLabel === '半场' ? [-1, 1] : [-1, 1, 2, 3]).map((value) => button(`${value > 0 ? '+' : '−'}${Math.abs(value)}`, { action: 'score', key: side, value, small: true, disabled: value < 0 && !event.score[side] })).join('')}</div>
      </div>`).join('')}</div>
    <div class="period-actions"><span class="period-label">${h(periodTitle(event))}</span>
      ${button('上一' + event.periodLabel, { action: 'period', value: event.score.period - 1, small: true, disabled: phase === 'running' || event.score.period <= 1 })}
      ${button('下一' + event.periodLabel, { action: 'period', value: event.score.period + 1, small: true, disabled: phase === 'running' || event.score.period >= 30 })}
    </div>
  </div>`;
}

export function operations(event, now) {
  if (!event) return '<section class="panel no-event"><p>建立赛事后即可现场操作。</p></section>';
  if (event.kind === 'ranking') return '<section class="panel no-event" aria-label="比赛操作"><p>赛制待定 · 可先导入队伍，再按裁判结果排列名次。</p></section>';
  const phase = clockPhase(event, now);
  const best = event.kind === 'field' ? standings(event)[0]?.value : null;
  const project = event.schedule?.project;
  const jump = project === 'high-jump';
  return `<section class="panel operations-panel operations-panel--${event.kind}" aria-label="比赛操作">
    ${event.kind === 'field' ? `<div class="field-summary"><span>${jump ? `当前横杆 <b>${jumpHeight(event)} cm</b>` : `已录 ${event.competitors.reduce((sum, athlete) => sum + athlete.attempts.length, 0)} 次`}</span>
      <span>当前最佳 <b>${best ? formatMark(best) : '—'}</b></span>${project === 'shot-put' ? `<span>铅球 ${event.division === 'women' ? 4 : 5} kg</span>` : ''}
      ${jump ? button(`升至 ${nextJumpHeight(event)} cm`, { action: 'jump-raise', glyph: 'plus', small: true, variant: 'capture', disabled: nextJumpHeight(event) > 300 }) : ''}</div>` :
      `${clocks(event, phase)}${event.kind === 'track' ? splitProgress(event, phase) : ballPanel(event, phase)}
      <div class="operation-footer">
        ${event.splits.length && checkpoints(event).length > 4 ? button('通过记录', { action: 'split-history', glyph: 'list', small: true }) : ''}
        ${event.kind === 'track' && event.splits.length ? button('撤销上次通过', { action: 'split-undo', small: true }) : ''}
        ${button('校时', { action: 'clock-set', glyph: 'timer', small: true, disabled: phase === 'running' })}
        ${button('重置', { action: 'clock-reset', glyph: 'reset', small: true, disabled: phase === 'ready' })}
      </div>`}
  </section>`;
}

export function rosterTools(event) {
  if (!event) return '';
  return `${event.kind === 'match' ? '<span class="roster-label">比赛比分</span>' : `
    ${button('添加选手', { action: 'athlete-add', glyph: 'plus', small: true })}
    ${button('导入 CSV', { action: 'csv-import', glyph: 'upload', small: true })}`}
    ${button('导出', { action: 'csv-export', glyph: 'download', small: true, accessible: '导出 CSV' })}`;
}

export function competitorPanel(event, now, { start, limit, onAir }) {
  if (!event) return '<p class="empty-table">选择赛事后显示名单。</p>';
  if (event.kind === 'match') return `<div class="match-summary">
    <span>${h(event.homeName)} <b>${event.score.home}</b></span><span>${h(event.awayName)} <b>${event.score.away}</b></span>
    <small>${h(periodTitle(event))}</small></div>`;
  const isField = event.kind === 'field';
  const heightTrials = event.schedule?.project === 'high-jump';
  const mixedRelay = event.schedule?.project === 'shuttle-50';
  const active = clockPhase(event, now) === 'running';
  const rowHtml = roster(event).slice(start, start + limit).map((athlete) => {
    const attempts = heightTrials ? (athlete.jumps ?? []).map(({ height, outcome }) => `${height}${outcome}`).join(' / ') :
      athlete.attempts.map((attempt) => typeof attempt === 'number' ? formatMark(attempt).replace(' m', '') : attempt).join(' / ');
    const canAttempt = heightTrials ? (canJump(event, athlete) || athlete.jumps?.length) : ['pending', 'ok', 'NM'].includes(athlete.status) && athlete.attempts.length < 12;
    const note = [athlete.team, event.kind === 'track' && event.schedule ? `第 ${athlete.heat ?? 1} 组` : '', mixedRelay ? relayRegistration(athlete) : ''].filter(Boolean).join(' · ');
    const isOffHeat = (athlete.heat ?? 1) !== (event.heat ?? 1);
    return `<tr>
      <td class="table-lane">${athlete.lane ?? '—'}</td><td class="table-bib tabular" title="${h(athlete.bib)}">${h(athlete.bib || '—')}</td>
      <th class="roster-name" scope="row" title="${h([athlete.name, note].filter(Boolean).join(' · '))}"><span>${h(athlete.name)}</span>${note ? `<small class="${mixedRelay && relayRegistration(athlete) === '人数不符' ? 'relay-invalid' : ''}">${h(note)}</small>` : ''}</th>
      <td class="table-result" title="${h(attempts || resultText(athlete, event))}"><strong class="tabular">${h(resultText(athlete, event))}</strong>${attempts ? `<small class="attempts">${h(attempts)}</small>` : ''}</td>
      <td><div class="row-actions">
        ${isField ? button('记试次', { action: 'attempt', key: athlete.id, small: true, variant: 'capture', disabled: !canAttempt }) :
          event.kind === 'track' ? button('记完赛', { action: 'athlete-finish', key: athlete.id, small: true, variant: 'capture', disabled: !onAir || !active || isOffHeat || athlete.status !== 'pending' }) : ''}
        ${button(`编辑 ${athlete.name}`, { action: 'athlete-edit', key: athlete.id, glyph: 'edit', iconOnly: true })}
        ${button(`人物条 ${athlete.name}`, { action: 'athlete-graphic', key: athlete.id, glyph: 'person', iconOnly: true, disabled: !onAir })}
      </div></td></tr>`;
  }).join('');
  return rowHtml ? `<table aria-label="选手明细"><colgroup><col class="lane-col"><col class="bib-col"><col><col class="result-col"><col class="action-col"></colgroup>
    <thead><tr><th scope="col">${isField ? '序' : '道'}</th><th scope="col">号码</th><th scope="col">姓名 / 队名</th><th scope="col">${isField ? '最佳' : '成绩'}</th><th scope="col">操作</th></tr></thead>
    <tbody>${rowHtml}</tbody></table>` : '<p class="empty-table">还没有选手，可添加或导入 CSV。</p>';
}

export function moduleList(state, event) {
  return Object.entries(MODULES).filter(([key]) => !['results', 'teams', 'score'].includes(key) && applicable(key, event)).map(([key, meta]) => {
    const live = state.modules[key].visible;
    const toggle = button(live ? '隐藏' : '显示', { action: 'module-toggle', key, accessible: `${live ? '隐藏' : '显示'}${meta.title}`, small: true, pressed: live, variant: 'tally-button' });
    const total = ['lineup', 'results'].includes(key) ? paginatedCount(event, key) : 1;
    return `<div class="module-item ${live ? 'module-item--live' : ''}">
      <div class="module-row">
        ${['notice', 'athlete'].includes(key) ? `<button class="module-label edit-text" type="button" data-action="text" data-key="${key}" title="编辑${meta.title}">${icon(meta.icon)}${meta.title}</button>` : `<span class="module-label">${icon(meta.icon)}${meta.title}</span>`}
        ${toggle}
      </div>
      ${live && total > 1 ? `<div class="page-steps">
        ${button('上一页', { action: 'page', key, value: state.pages[key] - 1, glyph: 'left', iconOnly: true, disabled: state.pages[key] === 0 })}
        <span aria-live="polite">${state.pages[key] + 1} / ${total}</span>
        ${button('下一页', { action: 'page', key, value: state.pages[key] + 1, glyph: 'right', iconOnly: true, disabled: state.pages[key] === total - 1 })}
        </div>` : ''}
    </div>`;
  }).join('');
}

export function options(entries, selected) {
  return Object.entries(entries).map(([key, label]) => `<option value="${h(key)}" ${key === String(selected) ? 'selected' : ''}>${h(label)}</option>`).join('');
}

export function input(label, name, value, attrs = '') {
  return `<label class="field"><span>${label}</span><input name="${name}" value="${h(value)}" ${attrs}></label>`;
}

export function select(label, name, values, selected) {
  return `<label class="field"><span>${label}</span><select name="${name}">${options(values, selected)}</select></label>`;
}

export function inspector({ state, key }) {
  const layout = state.modules[key];
  const { scale, opacity, enter, exit, duration } = layout;
  const { x, y } = modulePosition(key, layout);
  const bounds = moduleBounds(key, scale);
  return `<form id="layout-form" class="layout-form" novalidate>
    <div class="layout-head">
      ${select('调整图层', 'module', Object.fromEntries(Object.entries(MODULES).filter(([filter]) => applicable(filter, state.events.find((event) => event.id === state.activeEventId))).map(([id, meta]) => [id, meta.title])), key)}
      <div class="layout-tabs" aria-label="图层设置类别">${button('位置', { action: 'layout-section', key: 'position', small: true, pressed: true })}${button('样式', { action: 'layout-section', key: 'style', small: true, pressed: false })}</div>
    </div>
    <div class="layout-section" data-layout-section="position">
      <div class="field-triple">${input('水平 X', 'x', x, `type="number" min="0" max="${bounds.x}" required`)}${input('垂直 Y', 'y', y, `type="number" min="0" max="${bounds.y}" required`)}${input('缩放 %', 'scale', scale, `type="number" min="35" max="${moduleScaleLimit(key)}" required`)}</div>
      <div class="anchor-buttons">${[['tl', '左上'], ['tr', '右上'], ['bl', '左下'], ['br', '右下']].map(([anchor, name]) => button(name, { action: 'anchor', key: anchor, small: true })).join('')}</div>
      <p class="form-note">上屏图层可在监看中拖动。</p>
    </div>
    <div class="layout-section" data-layout-section="style" hidden>
      <div class="field-pair">${input('不透明度 %', 'opacity', opacity, 'type="number" min="0" max="100" required')}${input('动画时长 ms', 'duration', duration, 'type="number" min="80" max="2000" required')}</div>
      <div class="field-pair">${select('入场', 'enter', MOTIONS, enter)}${select('退场', 'exit', MOTIONS, exit)}</div>
    </div>
    <div class="layout-buttons">${button('恢复此项', { action: 'layout-reset', small: true })}<button class="button primary compact" type="submit">应用设置</button></div>
  </form>`;
}
