import { SportsClient, demo, escapeHtml as h } from './client.js';
import {
  CANVAS, GRADES, MODULES, SAFE_AREA, activeEvent, applicable, clamp, heats,
  lineupRoster, moduleBounds, modulePosition, paginatedCount, resultText, standings,
} from './sport.js';
import { className } from './meet-program.js';

const stage = document.querySelector('#stage');
const focusKey = new URLSearchParams(location.search).get('focus');
for (const [name, inset] of Object.entries(SAFE_AREA)) stage.style.setProperty(`--safe-${name}`, `${inset}px`);
const preview = window.parent !== window && new URLSearchParams(location.search).get('preview') === '1';
const layers = {};
const seal = '<img class="school-seal" src="/assets/yanzhou-seal.png" alt="">';
let state;
let editKey = '';
let drag;
let ratio = 1;

for (const key of Object.keys(MODULES)) {
  const node = document.createElement('section');
  node.className = `layer layer--${key}`;
  node.dataset.module = key;
  node.hidden = true;
  const content = document.createElement('div');
  content.className = 'graphic';
  node.append(content);
  stage.append(node);
  layers[key] = { node, content, shown: false, html: '', animation: null };
}

if (demo && !focusKey) stage.insertAdjacentHTML('beforeend', '<div class="rehearsal-mark">彩排</div>');

function resize() {
  ratio = Math.min(innerWidth / CANVAS.width, innerHeight / CANVAS.height);
  stage.style.transform = `translate(-50%, -50%) scale(${ratio})`;
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(document.documentElement);
resize();

const LANE_WORDS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function laneLabel(lane) {
  if (!lane) return '—';
  const word = LANE_WORDS[lane];
  return word ? `${word}道` : `${lane}道`;
}

function bibLabel(bib) {
  const value = String(bib || '').trim();
  return /^\d+$/.test(value) ? value.padStart(4, '0') : (value || '—');
}

function broadcastTitle(event) {
  const grade = event.schedule?.grade;
  const gradeLabel = grade && grade !== 'staff' ? GRADES[grade] : '';
  const division = event.division === 'men' ? '男子' : event.division === 'women' ? '女子' : '';
  const name = event.name.replace(/\s+/g, '');
  const stage = (event.stage || '').replace(/男子|女子/g, '');
  return `${gradeLabel}${division}${name}${stage}`;
}

function teamLabel(event, athlete) {
  if (!event.schedule?.grade || event.schedule.grade === 'staff') return athlete.team || '—';
  return className(event, athlete) || '—';
}

function lineupGraphic(event) {
  const page = state.pages.lineup;
  const athlete = lineupRoster(event)[page];
  if (!athlete) return `<div class="intro-board"><div class="intro-bar"><span class="intro-kicker">起跑前 · ${h(broadcastTitle(event))}</span><strong class="intro-name">等待参赛名单</strong></div></div>`;
  return `<div class="intro-board">
    <div class="intro-bar">
      <span class="intro-kicker">起跑前 · ${h(broadcastTitle(event))}</span>
      <div class="intro-main"><strong class="intro-name">${h(athlete.name)}</strong><span class="intro-bib">— ${h(bibLabel(athlete.bib))}</span></div>
    </div>
    <div class="intro-stub"><span class="intro-lane"><b>${h(athlete.lane ?? '—')}</b><small>道</small></span><small>${h(teamLabel(event, athlete))}</small><img class="school-seal" src="/assets/yanzhou-seal.png" alt=""></div>
  </div>`;
}

function championGraphic(event) {
  const winner = standings(event).find((row) => row.rank === 1);
  if (!winner) return `<div class="winner-card winner-card--empty"><span class="winner-tag">第 1 名</span><p class="winner-empty">等待冠军</p></div>`;
  const { athlete } = winner;
  const meta = [athlete.lane ? laneLabel(athlete.lane) : '', teamLabel(event, athlete)].filter(Boolean).join(' · ');
  return `<div class="winner-card">
    <img class="school-seal winner-seal" src="/assets/yanzhou-seal.png" alt="">
    <span class="winner-tag">第 1 名</span>
    <strong class="winner-name">${h(athlete.name)}</strong>
    <span class="winner-time">${h(resultText(athlete, event))}</span>
    <small class="winner-meta">${h(meta)}</small>
  </div>`;
}

/*
function tableGraphic(key, event) {
  // 完整成绩榜、比分和分页名单先不用。参赛名单改走 lineupGraphic，名次只留冠军。
  if (event.kind === 'match') return `<div class="table-board match-result">
    <header><span>${h(eventTitle(event))}</span><strong>比赛比分</strong></header>
    <div class="match-result-score"><b>${h(event.homeName)}</b><strong>${event.score.home} : ${event.score.away}</strong><b>${h(event.awayName)}</b></div>
    <footer>${h(periodTitle(event))}</footer></div>`;
  const ranked = key === 'results';
  const page = state.pages[key];
  const rows = ranked ? resultRows(event) : lineupRoster(event).map((athlete) => ({ athlete }));
  const part = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const title = ranked ? '成绩榜' : (event.kind === 'track' && heats(event).length > 1 ? `第 ${event.heat ?? 1} 组名单` : '参赛名单');
  return `<div class="table-board">
    <header>${seal}<span>${h(eventTitle(event))}</span><strong>${title}</strong></header>
    <div class="board-row board-labels"><span>${ranked ? '名次' : (event.kind === 'field' ? '序号' : '道次')}</span><span>号码</span><span>姓名 / 队名</span><span>单位</span>${ranked ? '<span>成绩</span>' : '<span></span>'}</div>
    ${part.map(({ athlete, rank }) => `<div class="board-row"><strong>${(ranked ? rank : athlete.lane) ?? '—'}</strong><span>${h(athlete.bib || '—')}</span><b>${h(athlete.name)}</b><span>${h(athlete.team || '—')}</span><strong>${ranked ? h(resultText(athlete, event)) : ''}</strong></div>`).join('')}
    ${part.length ? '' : `<div class="board-empty">${ranked ? '等待成绩' : '等待参赛名单'}</div>`}
    <footer><span>${h(state.meet.title)}</span><span>${page + 1} / ${paginatedCount(event, key)}</span></footer>
    </div>`;
}

function classGraphic(event) {
  const rows = state.classBoard ?? [];
  return `<div class="table-board class-board"><header>${seal}<span>${FESTIVAL_NAME}</span><strong>${GRADES[event.schedule.grade]}班级积分</strong></header>
    <div class="board-row board-labels"><span>名次</span><span>班级</span><span>破纪录</span><span>总分</span></div>
    ${rows.map(({ rank, team, records, total, tied }) => `<div class="board-row"><strong>${rank}</strong><b>${h(team)}${tied ? ' · 待抽签' : ''}</b><span>${records}</span><strong>${total}</strong></div>`).join('') || '<div class="board-empty">等待决赛计分</div>'}
    <footer><span>${h(state.meet.title)}</span><span>团体前八</span></footer></div>`;
}
*/

function sportsGraphic(key, event) {
  switch (key) {
    case 'brand': return `<div class="brand-ribbon">${seal}<div class="brand-copy">
      <img class="brand-wordmark" src="/assets/yanzhou-sport-wordmark.png" alt="YZBTVS SPORT" width="513" height="92">
      ${state.meet.subtitle ? `<small>${h(state.meet.subtitle)}</small>` : ''}</div></div>`;
    case 'event': {
      const group = event.kind === 'track' && heats(event).length > 1 ? `第 ${event.heat ?? 1} 组` : '';
      const grade = event.schedule?.grade;
      const context = [grade === 'staff' ? '' : GRADES[grade], event.stage, group, event.venue].filter(Boolean).join(' · ');
      return `<div class="event-ribbon"><div class="ticket-body"><strong>${h(event.name)}</strong>${context ? `<small>${h(context)}</small>` : ''}</div>
        <div class="ticket-stub">${seal}<span>${String(state.eventNumber).padStart(2, '0')}</span></div></div>`;
    }
    // case 'score': 球赛记分牌先不用。
    // case 'teams': 班级积分榜先不用。
    case 'lineup': return lineupGraphic(event);
    case 'results': return championGraphic(event);
    case 'athlete': return `<div class="athlete-ribbon">${state.athlete.tag ? `<small>${h(state.athlete.tag)}</small>` : ''}<div><strong>${h(state.athlete.name)}</strong><span>${h(state.athlete.detail)}</span></div></div>`;
    case 'notice': return `<div class="notice-ribbon"><b>${h(state.notice.title)}</b><span>${h(state.notice.body)}</span></div>`;
    default: return '';
  }
}

const keyframes = {
  fade: [{ opacity: 0 }, { opacity: 1 }],
  slide: [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
  side: [{ opacity: 0, transform: 'translateX(-32px)' }, { opacity: 1, transform: 'translateX(0)' }],
  zoom: [{ opacity: 0, transform: 'scale(.93)' }, { opacity: 1, transform: 'scale(1)' }],
};

function visibility(layer, visible, layout, immediate) {
  if (!immediate && visible === layer.shown) return;
  layer.shown = visible;
  layer.animation?.cancel();
  const frames = keyframes[visible ? layout.enter : layout.exit];
  if (immediate || !frames || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    layer.node.hidden = !visible;
    return;
  }
  layer.node.hidden = false;
  layer.animation = layer.content.animate(visible ? frames : [...frames].reverse(), { duration: layout.duration, easing: 'ease-out', fill: 'both' });
  layer.animation.onfinish = () => {
    layer.node.hidden = !layer.shown;
    layer.animation?.cancel();
  };
}

function place(node, x, y) {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
}

function placeAtLayout(key, node) {
  const layout = state.modules[key];
  if (!layout) return;
  const { x, y } = modulePosition(key, layout);
  place(node, x, y);
}

function layerSelection() {
  Object.entries(layers).forEach(([key, { node }]) => { node.classList.toggle('is-editable', preview && key === editKey); });
}

function render(snapshot) {
  const cut = !state || state.activeEventId !== snapshot.activeEventId;
  if (cut && drag) {
    const { key, pointerId } = drag;
    drag = undefined;
    const { node } = layers[key];
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
  }
  state = snapshot;
  stage.style.setProperty('--accent', state.meet.accent);
  const event = activeEvent(state);
  for (const [key, layer] of Object.entries(layers)) {
    const layout = state.modules[key];
    if (!layout) continue;
    const visible = (focusKey ? key === focusKey : layout.visible) && applicable(key, event);
    if (drag?.key !== key) placeAtLayout(key, layer.node);
    layer.node.style.transform = `scale(${layout.scale / 100})`;
    layer.node.style.opacity = layout.opacity / 100;
    if (visible) {
      const html = sportsGraphic(key, event);
      if (html !== layer.html) {
        layer.content.innerHTML = html;
        layer.html = html;
      }
    }
    visibility(layer, visible, layout, cut);
  }
}

const client = new SportsClient({ role: 'view', onState: render });

if (preview) {
  window.addEventListener('message', ({ source, origin, data }) => {
    if (origin !== location.origin || source !== window.parent || data?.type !== 'preview:settings') return;
    stage.classList.toggle('guides', data.guides === true);
    editKey = Object.hasOwn(layers, data.editKey) ? data.editKey : '';
    layerSelection();
    if (data.resetPosition && state) {
      for (const [key, layer] of Object.entries(layers)) placeAtLayout(key, layer.node);
    }
  });
  stage.addEventListener('pointerdown', (pointer) => {
    const node = pointer.target.closest('.is-editable');
    if (!state || !node || pointer.button !== 0) return;
    const key = node.dataset.module;
    const layout = state.modules[key];
    const { x, y } = modulePosition(key, layout);
    const { scale } = layout;
    drag = { key, x, y, eventId: state.activeEventId, startX: pointer.clientX, startY: pointer.clientY, initialX: x, initialY: y, bounds: moduleBounds(key, scale), pointerId: pointer.pointerId };
    node.setPointerCapture(pointer.pointerId);
    pointer.preventDefault();
  });
  stage.addEventListener('pointermove', (pointer) => {
    if (drag?.pointerId !== pointer.pointerId) return;
    drag.x = clamp(Math.round(drag.initialX + (pointer.clientX - drag.startX) / ratio), 0, drag.bounds.x);
    drag.y = clamp(Math.round(drag.initialY + (pointer.clientY - drag.startY) / ratio), 0, drag.bounds.y);
    place(layers[drag.key].node, drag.x, drag.y);
  });
  function endDrag(pointer) {
    if (drag?.pointerId !== pointer.pointerId) return;
    const { key, x, y, eventId, initialX, initialY } = drag;
    drag = undefined;
    if (pointer.type === 'pointercancel') place(layers[key].node, initialX, initialY);
    else if (x !== initialX || y !== initialY) window.parent.postMessage({ type: 'preview:move', key, x, y, eventId }, location.origin);
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  window.parent.postMessage({ type: 'preview:ready' }, location.origin);
}
