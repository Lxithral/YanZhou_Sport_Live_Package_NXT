import { escapeHtml as h } from './client.js';
import { athleteFields, button, icon, pager } from './control-views.js';
import { activeEvent, canJump, formatMark, formatTime, jumpHeight, resultText, roster, standings } from './sport.js';
import { beatsRecord } from './meet-program.js';

const SPECIAL = ['DNS', 'DNF', 'DQ', 'NM'];

export function createRanking({ getState, run, notify, updateRegion, confirm }) {
  const panel = document.querySelector('#ranking-panel');
  const rowsBox = document.querySelector('#rank-rows');
  let page = 0;
  let query = '';
  let limit = 8;
  let editing = null;
  let drag = null;
  let roomCache = { height: 0, room: 0 };

  function eventOf() {
    return activeEvent(getState());
  }

  function filtered(event) {
    const rows = roster(event);
    if (!query) return rows;
    const needle = query.trim().toLowerCase();
    return rows.filter((athlete) => `${athlete.name} ${athlete.bib} ${athlete.team}`.toLowerCase().includes(needle));
  }

  function roomPx() {
    if (roomCache.height === innerHeight && roomCache.room) return roomCache.room;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:0;height:var(--rank-room);';
    document.body.append(probe);
    const room = probe.getBoundingClientRect().height || 0;
    probe.remove();
    roomCache = { height: innerHeight, room };
    return room;
  }

  // 桌面三栏里表格由 flex 撑满：用「面板高度 - 其它兄弟元素高度」推算可用空间，
  // 不去量表格自身的高度，避免行数变化反过来改变可用空间造成抖动。
  function flexRoom() {
    const section = rowsBox.closest('section');
    const table = rowsBox.closest('.rank-table');
    if (!section || !table) return 0;
    const styles = getComputedStyle(section);
    const padding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    let used = padding;
    for (const child of section.children) {
      if (child === table || child.hidden) continue;
      used += child.getBoundingClientRect().height;
    }
    used += table.querySelector('.rank-head')?.getBoundingClientRect().height ?? 32;
    return section.clientHeight - used;
  }

  function measureLimit() {
    const rowHeight = parseFloat(getComputedStyle(rowsBox).getPropertyValue('--rank-row')) || 38;
    let usable = 0;
    if (getComputedStyle(rowsBox).flexGrow !== '0') {
      usable = flexRoom();
    } else {
      const room = roomPx();
      if (!room) return limit;
      usable = document.querySelector('#school-race-actions')?.textContent.trim() ? room - 34 : room;
    }
    if (usable < rowHeight) return limit;
    return Math.max(3, Math.floor(usable / rowHeight));
  }

  function rowsMarkup(event, places) {
    if (event.kind === 'match') return '';
    const all = filtered(event);
    const start = page * limit;
    const slice = all.slice(start, start + limit);
    if (!slice.length) {
      return `<p class="empty-table" style="border:0;min-height:0">${query ? '没有匹配的选手' : '还没有选手，先在「备赛名单」里添加'}</p>`;
    }
    return slice.map((athlete) => rowMarkup(event, athlete, places.get(athlete.id))).join('') + (editing ? editorMarkup(event, all.find((athlete) => athlete.id === editing), places.get(editing)) : '');
  }

  function rowMarkup(event, athlete, row) {
    const detail = [athlete.team, athlete.heat && event.kind === 'track' ? `第 ${athlete.heat} 组` : ''].filter(Boolean).join(' · ');
    const placed = row?.rank != null;
    const text = resultText(athlete, event);
    const note = beatsRecord(athlete, event) ? '<span class="result-note">超校纪录</span>' : '';
    const actions = placed
      ? `${button('录入', { action: 'result-edit', key: athlete.id, small: true, variant: 'subtle' })}${button('编辑', { action: 'athlete-edit', key: athlete.id, glyph: 'edit', small: true, iconOnly: true, accessible: `编辑 ${athlete.name}` })}`
      : `${button('入榜', { action: 'rank-append', key: athlete.id, small: true })}${button('编辑', { action: 'athlete-edit', key: athlete.id, glyph: 'edit', small: true, iconOnly: true, accessible: `编辑 ${athlete.name}` })}`;
    return `<div class="rank-row${placed ? ' placed' : ''}${athlete.time != null || athlete.attempts?.length ? ' has-time' : ''}" data-placed="${placed ? athlete.id : ''}" data-row="${athlete.id}" role="row">
      <span class="rank-grip" role="button" tabindex="0" aria-label="拖动调整 ${h(athlete.name)} 的名次" title="拖动调整名次">${icon('grip')}</span>
      <span class="rank-number" role="cell">${placed ? `<b>${row.rank}</b>` : '—'}</span>
      <span class="rank-number tabular" role="cell">${h(athlete.bib || '—')}</span>
      <span class="rank-name" role="cell"><strong>${h(athlete.name)}</strong>${detail ? `<small>${h(detail)}</small>` : ''}</span>
      <span class="rank-mark" role="cell"><span class="tabular">${h(text)}</span>${note}</span>
      <span class="rank-actions">${actions}</span>
    </div>`;
  }

  function editorMarkup(event, athlete, row) {
    if (!athlete) return '';
    const jumps = event.schedule?.project === 'high-jump';
    if (jumps) {
      const bar = jumpHeight(event);
      const series = (athlete.jumps ?? []).map(({ height, outcome }) => `${height}:${outcome}`).join(' ') || '暂无试跳';
      return `<div class="rank-editor" role="row" data-editor="${athlete.id}">
        <p class="re-title"><strong>${h(athlete.name)}</strong><span>横杆 ${bar} cm</span><span>${h(series)}</span></p>
        <div class="re-actions">
          ${button('免跳', { action: 'jump-mark', value: '-', small: true })}
          ${button('失败 X', { action: 'jump-mark', value: 'X', small: true })}
          ${button('过杆 O', { action: 'jump-mark', value: 'O', small: true, variant: 'primary' })}
          ${button('撤销', { action: 'jump-undo', small: true })}
          ${button('关闭', { action: 'result-cancel', small: true, variant: 'subtle' })}
        </div>
        <p class="re-hint">也可点「升杆」调整横杆高度，撤销会撤回最近一次试跳。</p>
      </div>`;
    }
    const field = event.kind === 'field';
    const hint = field
      ? `已记录 ${athlete.attempts?.length ?? 0} 次。输入 5.35 记为有效，X 记犯规，- 记放弃。`
      : '输入 03:21.52 或 3:21.52；输入 DNS、DNF、DQ 标记状态。';
    return `<form class="rank-editor" role="row" data-editor="${athlete.id}">
      <p class="re-title"><strong>${h(athlete.name)}</strong><span>${h(athlete.bib || '—')}</span><span>当前 ${h(resultText(athlete, event))}</span></p>
      <input class="re-input" name="mark" autocomplete="off" spellcheck="false" inputmode="${field ? 'decimal' : 'text'}" placeholder="${field ? '5.35 或 X' : '03:21.52'}" aria-label="录入成绩">
      <div class="re-actions">
        <button type="submit" class="button primary">${field ? '记录试次' : '保存成绩'}</button>
        ${button('取消', { action: 'result-cancel', small: true, variant: 'subtle' })}
      </div>
      <p class="re-hint">${hint} 回车保存，Esc 取消。</p>
    </form>`;
  }

  function stageMarkup(event, visible) {
    if (!event) return '';
    const winner = standings(event).find((row) => row.rank === 1);
    const label = event.kind === 'match' ? '比分牌' : '冠军榜';
    const small = winner ? `第一名 ${winner.athlete.name} · ${resultText(winner.athlete, event)}` : '等待第一名产生';
    const action = button(visible ? '撤下' : '上屏', {
      action: 'rank-live',
      variant: visible ? 'published' : 'primary',
      glyph: visible ? 'eye-off' : 'screen',
      accessible: `${visible ? '撤下' : '上屏'}${label}`,
    });
    return `<div class="stage-card${visible ? ' live' : ''}">
      <span class="stage-copy"><strong>${label}</strong><small>${h(small)}</small></span>
      ${action}
    </div>`;
  }

  function render() {
    const state = getState();
    if (!state) return;
    const event = eventOf();
    if (!event) {
      for (const id of ['#rank-controls', '#rank-mode', '#rank-rows', '#rank-summary', '#rank-pager', '#rank-reset-control', '#school-race-actions']) updateRegion(id, '');
      panel.dataset.kind = '';
      return;
    }
    panel.dataset.kind = event.kind;
    const matchEvent = event.kind === 'match';
    const unavailable = panel.querySelector('#rank-unavailable');
    const table = panel.querySelector('.rank-table');
    unavailable.hidden = !matchEvent;
    table.hidden = matchEvent;
    if (matchEvent) unavailable.textContent = '球赛用页面下方的比分条记分，名次榜不参与这场比赛。';
    const visible = state.modules.results.visible;
    rowsBox.classList.toggle('is-editing', Boolean(editing));
    updateRegion('#rank-controls', event.kind === 'match' ? '' : stageMarkup(event, visible));
    updateRegion('#rank-mode', event.rankOrder ? '手动排名' : '按成绩');
    limit = measureLimit();
    if (editing && !event.competitors.some((athlete) => athlete.id === editing)) editing = null;
    const places = new Map(standings(event).filter((row) => row.rank !== null).map((row) => [row.athlete.id, row]));
    const paint = () => {
      const all = filtered(event);
      page = Math.min(page, Math.max(0, Math.ceil(all.length / limit) - 1));
      rowsBox.innerHTML = rowsMarkup(event, places);
      updateRegion('#rank-pager', pager('rank-page', page, Math.ceil(all.length / limit)));
    };
    paint();
    // 兄弟元素（工具栏换行、录入回执文字）会改变可用高度，渲染完再量一次并纠正一次行数
    const corrected = measureLimit();
    if (corrected !== limit) {
      limit = corrected;
      paint();
    }
    const placed = places.size;
    updateRegion('#rank-summary', `${event.competitors.length} 位选手 · ${placed} 已排名`);
    updateRegion('#rank-reset-control', placed ? button('清空名次', { action: 'rank-reset', small: true, variant: 'subtle' }) : '');
    if (editing) focusEditor();
    if (editing) focusEditor();
  }

  function focusEditor() {
    const input = panel.querySelector('.rank-editor .re-input');
    if (input) {
      input.focus();
      input.select();
    }
  }

  function openEditor(id) {
    editing = id;
    render();
  }

  function closeEditor() {
    editing = null;
    render();
  }

  async function saveMark(event, athlete, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const upper = raw.toUpperCase();
    if (event.kind === 'field') {
      await run('athlete:attempt', { eventId: event.id, id: athlete.id, value: upper === 'X' || upper === '-' ? upper : raw, index: athlete.attempts?.length ?? 0 });
    } else {
      const status = SPECIAL.includes(upper) ? upper : '';
      await run('athlete:save', { eventId: event.id, id: athlete.id, fields: { ...athleteFields(athlete), result: status ? upper : raw, status } });
    }
    editing = null;
  }

  panel.addEventListener('submit', async (event) => {
    const form = event.target.closest('.rank-editor');
    if (!form) return;
    event.preventDefault();
    const current = eventOf();
    const athlete = current?.competitors.find((row) => row.id === form.dataset.editor);
    const input = form.querySelector('[name=mark]');
    if (!athlete || !input) return;
    try {
      await saveMark(current, athlete, input.value);
      render();
    } catch (error) {
      notify(error.message, true);
      input.focus();
    }
  });

  panel.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || target.closest('#rank-data-tools')) return;
    const { action, key, value } = target.dataset;
    const current = eventOf();
    if (!current) return;
    const athlete = key ? current.competitors.find((row) => row.id === key) : null;
    try {
      if (action === 'result-edit') openEditor(key);
      else if (action === 'result-cancel') closeEditor();
      else if (action === 'jump-mark') {
        if (!athlete) return;
        await run('jump:mark', { eventId: current.id, id: athlete.id, height: jumpHeight(current), outcome: value, index: athlete.jumps?.length ?? 0 });
        render();
      } else if (action === 'jump-undo') {
        if (!athlete) return;
        await run('jump:undo', { eventId: current.id, id: athlete.id, index: athlete.jumps?.length ?? 0 });
        render();
      } else if (action === 'rank-append') await run('rank:move', { eventId: current.id, id: key, beforeId: null });
      else if (action === 'rank-return') await run('rank:remove', { eventId: current.id, id: key });
      else if (action === 'rank-live') await run('module:save', { key: 'results', patch: { visible: !getState().modules.results.visible }, eventId: current.id });
      else if (action === 'rank-reset') {
        if (!(await confirm('清空名次', '将清空这场比赛的手动名次，成绩本身会保留。', '清空名次', () => run('rank:reset', { eventId: current.id })))) return;
      } else if (action === 'rank-page') {
        page = Math.max(0, Number(value) || 0);
        render();
      } else return;
    } catch (error) {
      notify(error.message, true);
    }
  });

  panel.addEventListener('input', (event) => {
    if (event.target.id === 'rank-search') {
      query = event.target.value;
      page = 0;
      render();
    }
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      closeEditor();
      return;
    }
    const grip = event.target.closest('.rank-grip');
    if (!grip || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    moveBy(grip.closest('.rank-row'), event.key === 'ArrowUp' ? -1 : 1);
  });

  async function moveBy(row, delta) {
    const current = eventOf();
    if (!current || !row) return;
    const id = row.dataset.row;
    const placed = standings(current).filter((entry) => entry.rank !== null).map((entry) => entry.athlete.id);
    const index = placed.indexOf(id);
    if (index < 0) {
      try {
        await run('rank:move', { eventId: current.id, id, beforeId: null });
        render();
      } catch (error) {
        notify(error.message, true);
      }
      return;
    }
    const target = index + delta;
    if (target < 0 || target >= placed.length) return;
    const beforeId = delta < 0 ? (placed[target] ?? null) : (placed[target + 1] ?? null);
    try {
      await run('rank:move', { eventId: current.id, id, beforeId });
      render();
    } catch (error) {
      notify(error.message, true);
    }
  }

  rowsBox.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('.rank-grip');
    if (!grip || event.button !== 0) return;
    const row = grip.closest('.rank-row');
    drag = { row, id: row.dataset.row, startY: event.clientY, moved: false, pointerId: event.pointerId, target: null, after: false };
    grip.setPointerCapture(event.pointerId);
  });

  rowsBox.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
    drag.moved = true;
    rowsBox.classList.add('ranking-drag');
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest('.rank-row');
    for (const row of rowsBox.querySelectorAll('.rank-row')) row.classList.remove('rank-drop', 'rank-drop-before', 'rank-drop-after');
    drag.target = null;
    if (!hit || hit === drag.row) return;
    const box = hit.getBoundingClientRect();
    drag.after = event.clientY > box.top + box.height / 2;
    hit.classList.add('rank-drop', drag.after ? 'rank-drop-after' : 'rank-drop-before');
    drag.target = hit;
  });

  rowsBox.addEventListener('pointerup', async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { id, target, after, moved } = drag;
    drag = null;
    rowsBox.classList.remove('ranking-drag');
    for (const row of rowsBox.querySelectorAll('.rank-row')) row.classList.remove('rank-drop', 'rank-drop-before', 'rank-drop-after');
    if (!moved || !target) return;
    const current = eventOf();
    if (!current) return;
    const placed = standings(current).filter((row) => row.rank !== null).map((row) => row.athlete.id);
    const targetId = target.dataset.row;
    const targetIndex = placed.indexOf(targetId);
    let beforeId = null;
    if (after) beforeId = targetIndex < 0 ? null : (placed[targetIndex + 1] ?? null);
    else beforeId = targetIndex < 0 ? null : targetId;
    if (beforeId === id) return;
    try {
      await run('rank:move', { eventId: current.id, id, beforeId });
      render();
    } catch (error) {
      notify(error.message, true);
    }
  });

  rowsBox.addEventListener('pointercancel', () => {
    drag = null;
    rowsBox.classList.remove('ranking-drag');
  });

  const observer = new ResizeObserver(() => {
    roomCache = { height: 0, room: 0 };
    const next = measureLimit();
    if (next !== limit) render();
  });
  observer.observe(panel);
  window.addEventListener('resize', () => {
    roomCache = { height: 0, room: 0 };
    if (measureLimit() !== limit) render();
  });

  return {
    render,
    reset() {
      page = 0;
      query = '';
      editing = null;
      const search = panel.querySelector('#rank-search');
      if (search) search.value = '';
    },
  };
}
