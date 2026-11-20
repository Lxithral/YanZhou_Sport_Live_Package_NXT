import { escapeHtml as h } from './client.js';
import { button, pager, rosterTools } from './control-views.js';
import { activeEvent, canJump, canRank, clamp, clockPhase, lineupRoster, paginatedCount, resultRows, resultText, standings } from './sport.js';
import { beatsRecord } from './meet-program.js';

function tableRows(event, entries, now) {
  const running = event.kind === 'track' && clockPhase(event, now) === 'running';
  return entries.map((entry) => {
    if (entry.drop) return '<div class="rank-slot" data-rank-drop role="row"><span role="cell" aria-colspan="6">拖到这里确认名次</span></div>';
    const { athlete, rank } = entry;
    const eligible = canRank(athlete);
    const trial = event.kind === 'field' && (event.schedule?.project === 'high-jump' ? (canJump(event, athlete) || athlete.jumps?.length) :
      ['pending', 'ok', 'NM'].includes(athlete.status) && athlete.attempts.length < 12);
    const placement = rank !== null
      ? button('撤回', { action: 'rank-return', key: athlete.id, accessible: '撤回名次 ' + athlete.name, small: true, iconOnly: trial, glyph: trial ? 'left' : undefined })
      : eligible ? button(running && athlete.status === 'pending' ? '记完赛' : '入榜', {
        action: running && athlete.status === 'pending' ? 'athlete-finish' : 'rank-append', key: athlete.id,
        accessible: (running && athlete.status === 'pending' ? '记完赛 ' : '入榜 ') + athlete.name, small: true, variant: 'capture', iconOnly: trial, glyph: trial ? 'plus' : undefined,
      }) : '';
    const trialControl = trial ? button('记试次', { action: 'attempt', key: athlete.id, accessible: '记试次 ' + athlete.name, small: true, variant: 'capture' }) : '';
    const grip = eligible ? button(`拖动 ${athlete.name}`, { action: 'rank-grip', key: athlete.id, glyph: 'grip', iconOnly: true, variant: 'rank-grip' }) : '';
    const edit = button(`编辑 ${athlete.name}`, { action: 'athlete-edit', key: athlete.id, glyph: 'edit', iconOnly: true });
    const detail = [athlete.team, event.kind === 'track' && event.schedule ? `第 ${athlete.heat ?? 1} 组` : ''].filter(Boolean).join(' · ');
    const nameAndTeam = [athlete.name, detail].filter(Boolean).join(' · ');
    return `<div class="rank-row" role="row" data-rank-id="${h(athlete.id)}" ${rank !== null ? 'data-placed="true"' : ''}>
      <span role="cell">${grip}</span>
      <span class="rank-number" role="cell">${rank !== null ? `<b>${rank}</b>` : '—'}</span>
      <span class="rank-number" role="cell" title="${h(athlete.bib)}">${h(athlete.bib || '—')}</span>
      <span class="rank-name" role="cell" title="${h(nameAndTeam)}"><strong>${h(athlete.name)}</strong>${detail ? `<small>${h(detail)}</small>` : ''}</span>
      <span class="rank-mark" role="cell">${h(resultText(athlete, event))}${beatsRecord(athlete, event) ? '<small class="result-note">超校纪录</small>' : ''}</span>
      <span class="rank-actions" role="cell">${trialControl}${placement}${edit}</span>
    </div>`;
  }).join('');
}

export function createRanking({ getState, getTime, run, notify, updateRegion, confirm }) {
  const panel = document.querySelector('#ranking-panel');
  const output = document.querySelector('#rank-controls');
  const table = panel.querySelector('.rank-table');
  const rowsNode = panel.querySelector('#rank-rows');
  const empty = panel.querySelector('#rank-unavailable');
  const search = panel.querySelector('#rank-search');
  let page = 0;
  let limit = 9;
  let renderedId;
  let shownHeat;
  let drag;

  function render() {
    const state = getState();
    if (!state) return;
    const event = activeEvent(state);
    const now = getTime();
    const heat = event?.kind === 'track' && event.schedule && clockPhase(event, now) === 'running' ? event.heat ?? 1 : null;
    if (event?.id !== renderedId || shownHeat !== heat) {
      page = 0;
      search.value = '';
      renderedId = event?.id;
      shownHeat = heat;
    }
    if (drag && drag.eventId !== renderedId) endDrag();
    const available = Boolean(event && event.kind !== 'match');
    const visible = state.modules.results.visible;
    const title = event?.kind === 'match' ? '比分' : '成绩榜';
    const ready = event && (!available || resultRows(event).length > 0);
    const show = button(title + (visible ? '下屏' : '上屏'), {
      action: 'rank-live', glyph: 'screen', variant: visible ? 'published' : 'primary', pressed: visible, disabled: !visible && !ready,
    });
    const pages = visible && event ? paginatedCount(event, 'results') : 1;
    updateRegion('#rank-controls', event ? show + (pages > 1 ? '<div class="pager output-pager">' + pager('rank-output-page', state.pages.results, pages, '成绩榜') + '</div>' : '') : '');
    updateRegion('#rank-mobile-action', event ? show : '');
    updateRegion('#rank-data-tools', available ? rosterTools(event) : '');
    updateRegion('#rank-reset-control', available && event.rankOrder ? button('恢复按成绩', { action: 'rank-reset', small: true }) : '');
    panel.querySelector('#rank-mode').textContent = heat ? `第 ${heat} 组计时` : available && event.competitors.length ? (event.rankOrder ? '手动排名' : '按成绩') : '';
    search.disabled = !available || !event.competitors.length;
    const current = available ? standings(event) : [];
    const all = heat ? current.filter(({ athlete }) => (athlete.heat ?? 1) === heat) : current;
    const term = search.value.trim().toLocaleLowerCase();
    const matches = term ? all.filter(({ athlete }) => [athlete.name, athlete.bib, athlete.team].some(value => value.toLocaleLowerCase().includes(term))) : all;
    const placed = matches.filter(({ rank }) => rank !== null);
    const other = matches.filter(({ rank }) => rank === null);
    const items = other.some(({ athlete }) => canRank(athlete)) ? [...placed, { drop: true }, ...other] : [...placed, ...other];

    table.hidden = !items.length;
    empty.hidden = Boolean(items.length);
    empty.textContent = !event ? '选择赛事后即可导入选手和排名。' :
      !available ? '球赛比分可在计时区操作。' :
        term ? '没有符合条件的选手。' : (heat && !lineupRoster(event).length ? '当前计时分组没有选手。' : '还没有选手。先导入 CSV 或添加选手。');
    rowsNode.style.setProperty('--rank-count', String(items.length));
    const total = Math.max(1, Math.ceil(items.length / limit));
    page = clamp(page, 0, total - 1);
    updateRegion('#rank-rows', tableRows(event, items.slice(page * limit, (page + 1) * limit), now));
    updateRegion('#rank-pager', total > 1 ? pager('rank-page', page, total, '选手') : '');
    panel.querySelector('#rank-summary').textContent = available && all.length
      ? (term ? matches.length + ' / ' + all.length + ' 位选手' : all.length + ' 位选手') + ' · ' + all.filter(({ rank }) => rank !== null).length + ' 已排名'
      : '';
  }

  const observer = new ResizeObserver(([{ contentRect }]) => {
    if (!contentRect.height) return;
    const row = Number.parseFloat(getComputedStyle(rowsNode).getPropertyValue('--rank-row'));
    const next = Math.max(1, Math.floor(contentRect.height / row));
    if (next === limit) return;
    page = Math.floor(limit * page / next);
    limit = next;
    render();
  });
  observer.observe(rowsNode);
  search.addEventListener('input', () => { page = 0; render(); });

  const commit = (action, args) => run(action, args).catch((error) => notify(error.message, true));

  function handleClick(e) {
    const control = e.target.closest('[data-action]');
    const state = getState();
    const event = state && activeEvent(state);
    if (!control || !event) return;
    const { action, key: id, value } = control.dataset;
    const args = { eventId: event.id, id };
    switch (action) {
      case 'rank-append': void commit('rank:move', args); break;
      case 'rank-return': void commit('rank:remove', args); break;
      case 'rank-live': void commit('module:save', { key: 'results', eventId: event.id, patch: { visible: !state.modules.results.visible } }); break;
      case 'rank-reset':
        confirm('恢复按成绩排序？', '手动名次将清除，成绩榜按已录入的时间或距离重新排序。', '恢复排序', () => run('rank:reset', args));
        break;
      case 'rank-page': page = Number(value); render(); break;
      case 'rank-output-page': void commit('page:set', { eventId: event.id, key: 'results', page: Number(value) }); break;
      default: break;
    }
  }
  panel.addEventListener('click', handleClick);
  output.addEventListener('click', handleClick);

  const placedIds = (event) => standings(event).filter(({ rank }) => rank !== null).map(({ athlete }) => athlete.id);
  panel.addEventListener('keydown', (e) => {
    const handle = e.target.closest('.rank-grip');
    if (!handle || !['ArrowUp', 'ArrowDown'].includes(e.key) || !handle.closest('[data-placed]')) return;
    const event = activeEvent(getState());
    const ids = placedIds(event);
    const id = handle.dataset.key;
    const index = ids.indexOf(id);
    const next = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (index < 0 || next < 0 || next >= ids.length) return;
    e.preventDefault();
    void commit('rank:move', { eventId: event.id, id, beforeId: ids[next < index ? next : next + 1] ?? null });
  });

  function clearMarker() {
    panel.querySelectorAll('.rank-drop, .rank-drop-before, .rank-drop-after').forEach((node) =>
      node.classList.remove('rank-drop', 'rank-drop-before', 'rank-drop-after'));
  }

  function endDrag() {
    if (!drag) return;
    const { pointerId } = drag;
    drag = undefined;
    clearMarker();
    panel.classList.remove('ranking-drag');
    if (panel.hasPointerCapture(pointerId)) panel.releasePointerCapture(pointerId);
  }

  function dropTarget(e, event) {
    const marker = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-placed], [data-rank-drop]');
    if (!marker || !panel.contains(marker)) return null;
    if (marker.hasAttribute('data-rank-drop')) return { beforeId: null, marker, style: 'rank-drop' };
    const id = marker.dataset.rankId;
    const box = marker.getBoundingClientRect();
    const before = e.clientY < box.top + box.height / 2;
    const ids = placedIds(event);
    return { beforeId: before ? id : (ids[ids.indexOf(id) + 1] ?? null), marker, style: before ? 'rank-drop-before' : 'rank-drop-after' };
  }

  panel.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.rank-grip');
    if (!handle || e.button !== 0 || drag) return;
    const event = activeEvent(getState());
    drag = { pointerId: e.pointerId, eventId: event.id, id: handle.dataset.key, x: e.clientX, y: e.clientY, moved: false };
    panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', (e) => {
    if (drag?.pointerId !== e.pointerId || (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5)) return;
    drag.moved = true;
    panel.classList.add('ranking-drag');
    clearMarker();
    const target = dropTarget(e, activeEvent(getState()));
    target?.marker.classList.add(target.style);
  });
  panel.addEventListener('pointerup', (e) => {
    if (drag?.pointerId !== e.pointerId) return;
    const event = activeEvent(getState());
    const { id, eventId, moved } = drag;
    const target = moved && event?.id === eventId ? dropTarget(e, event) : null;
    endDrag();
    if (target && target.beforeId !== id) void commit('rank:move', { eventId, id, beforeId: target.beforeId });
  });
  for (const type of ['pointercancel', 'lostpointercapture']) panel.addEventListener(type, (e) => {
    if (drag?.pointerId === e.pointerId) endDrag();
  });

  return { render };
}
