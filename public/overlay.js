import { SportsClient, escapeHtml as h } from './client.js';
import {
  CANVAS, GRADES, KINDS, MODULES, OUTPUT_LAYERS, SAFE_AREA, activeEvent, championAthlete, clamp, defaultLayout, eventStage, eventTitle, heats,
  lineupRoster, moduleBounds, moduleHasContent, modulePosition, resultText,
} from './sport.js';
import { className } from './meet-program.js';
import {
  brandGraphic, brandingMode, cornerBounds, mountBrandCorners, showBrandCorner, showBrandLayer,
} from './branding.js';

const stage = document.querySelector('#stage');
const query = new URLSearchParams(location.search);
const focusKey = query.get('focus');
const mode = brandingMode(query);
const staticPreview = stage.hasAttribute('data-branding-preview');
for (const [name, inset] of Object.entries(SAFE_AREA)) stage.style.setProperty(`--safe-${name}`, `${inset}px`);
const preview = window.parent !== window && query.get('preview') === '1';
const layers = {};
const brandCorners = mode === 'modern' && !focusKey ? mountBrandCorners(stage) : [];
const replaces = { event: ['lineup'], lineup: ['event', 'results'], results: ['lineup'] };
let state;
let editKey = '';
let drag;
let ratio = 1;

for (const key of OUTPUT_LAYERS) {
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

function teamLabel(event, athlete) {
  if (!event.schedule?.grade || event.schedule.grade === 'staff') return athlete.team || '—';
  return className(event, athlete) || '—';
}

function lineupGraphic(event) {
  const page = state.pages.lineup;
  const athlete = lineupRoster(event)[page];
  if (!athlete) return '';
  const { name } = athlete;
  const length = [...name].length;
  const lines = length > 22 ? 3 : length > 6 ? 2 : 1;
  const nameSize = clamp(Math.floor(286 / Math.ceil(length / lines)), 24, 76);
  const title = eventTitle(event);
  const titleSize = Math.min(28, Math.floor(920 / Math.max(1, [...title].length)));
  const lane = athlete.lane ? laneLabel(athlete.lane) : '';
  const team = teamLabel(event, athlete);
  const teamSize = clamp(Math.floor(720 / Math.max(1, [...team].length)), 23, 38);
  return `<div class="intro-board">
    <div class="intro-bar">
      <span class="intro-kicker" style="--intro-title-size: ${Math.max(22, titleSize)}px">${h(title)}</span>
      <div class="intro-main">${lane ? `<span class="intro-lane">${h(lane)}</span>` : ''}<span class="intro-team" style="--intro-team-size: ${teamSize}px">${h(team)}</span></div>
    </div>
    <div class="intro-stub"><strong class="intro-name" style="--name-size: ${nameSize}px">${h(name)}</strong></div>
  </div>`;
}

function championGraphic(event) {
  const winner = championAthlete(event);
  if (!winner) return '';
  const { name } = winner;
  const time = resultText(winner, event);
  const team = winner.team ? teamLabel(event, winner) : '';
  const nameLength = [...name].length;
  const teamLength = [...team].length;
  const nameLimit = nameLength <= 4 ? 72 : teamLength > 26 ? 46 : 56;
  const nameSize = Math.min(nameLimit, Math.max(28, Math.floor(280 / Math.ceil(nameLength / 2))));
  const teamSize = Math.min(30, Math.max(22, Math.floor(280 / Math.min(teamLength || 1, 14))));
  const timeSize = Math.min(54, Math.max(22, Math.floor(280 / (time.length * .62))));
  return `<div class="winner-card" aria-label="冠军">
    <div class="winner-crown">冠军</div>
    <div class="winner-body">
      <strong class="winner-name" style="--name-size: ${nameSize}px">${h(name)}</strong>
      ${team ? `<span class="winner-team" style="--team-size: ${teamSize}px">${h(team)}</span>` : ''}
    </div>
    <div class="winner-result">
      <span class="winner-result-label">成绩</span>
      <span class="winner-time" style="--time-size: ${timeSize}px">${h(time)}</span>
    </div>
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
    <header><img class="school-seal" src="/assets/yanzhou-seal.png" alt=""><span>${h(eventTitle(event))}</span><strong>${title}</strong></header>
    <div class="board-row board-labels"><span>${ranked ? '名次' : (event.kind === 'field' ? '序号' : '道次')}</span><span>号码</span><span>姓名 / 队名</span><span>单位</span>${ranked ? '<span>成绩</span>' : '<span></span>'}</div>
    ${part.map(({ athlete, rank }) => `<div class="board-row"><strong>${(ranked ? rank : athlete.lane) ?? '—'}</strong><span>${h(athlete.bib || '—')}</span><b>${h(athlete.name)}</b><span>${h(athlete.team || '—')}</span><strong>${ranked ? h(resultText(athlete, event)) : ''}</strong></div>`).join('')}
    ${part.length ? '' : `<div class="board-empty">${ranked ? '等待成绩' : '等待参赛名单'}</div>`}
    <footer><span>${h(state.meet.title)}</span><span>${page + 1} / ${paginatedCount(event, key)}</span></footer>
    </div>`;
}

function classGraphic(event) {
  const rows = state.classBoard ?? [];
  return `<div class="table-board class-board"><header><img class="school-seal" src="/assets/yanzhou-seal.png" alt=""><span>${FESTIVAL_NAME}</span><strong>${GRADES[event.schedule.grade]}班级积分</strong></header>
    <div class="board-row board-labels"><span>名次</span><span>班级</span><span>破纪录</span><span>总分</span></div>
    ${rows.map(({ rank, team, records, total, tied }) => `<div class="board-row"><strong>${rank}</strong><b>${h(team)}${tied ? ' · 待抽签' : ''}</b><span>${records}</span><strong>${total}</strong></div>`).join('') || '<div class="board-empty">等待决赛计分</div>'}
    <footer><span>${h(state.meet.title)}</span><span>团体前八</span></footer></div>`;
}
*/

function sportsGraphic(key, event) {
  switch (key) {
    case 'brand': return brandGraphic(mode, state.meet.subtitle);
    case 'event': {
      const group = event.kind === 'track' && heats(event).length > 1 ? `第 ${event.heat ?? 1} 组` : '';
      const grade = event.schedule?.grade;
      const context = [grade === 'staff' ? '' : GRADES[grade], eventStage(event), group].filter(Boolean).join(' · ');
      const titleSize = Math.min(54, Math.max(22, Math.floor(440 / Math.min([...event.name].length, 20))));
      const contextSize = Math.min(26, Math.max(18, Math.floor(440 / ([...context].length || 1))));
      return `<div class="event-banner">
        <span class="eb-tag">${h(KINDS[event.kind] ?? '赛事')}</span>
        <div class="eb-copy">
          <strong style="--title-size: ${titleSize}px">${h(event.name)}</strong>
          ${context ? `<small style="--context-size: ${contextSize}px">${h(context)}</small>` : ''}
        </div>
      </div>`;
    }
    // case 'score': 球赛记分牌先不用。
    // case 'teams': 班级积分榜先不用。
    case 'lineup': return lineupGraphic(event);
    case 'results': return championGraphic(event);
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
  layer.animation = null;
  const frames = keyframes[visible ? layout.enter : layout.exit];
  if (immediate || !frames || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    layer.node.hidden = !visible;
    return;
  }
  layer.node.hidden = false;
  const animation = layer.content.animate(visible ? frames : [...frames].reverse(), { duration: layout.duration, easing: 'ease-out', fill: 'both' });
  layer.animation = animation;
  animation.onfinish = () => {
    if (layer.animation !== animation) return;
    layer.node.hidden = !layer.shown;
    animation.cancel();
    layer.animation = null;
    updateBrandCorners();
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
  if (key === 'brand' && mode === 'legacy') {
    place(node, Math.min(x, CANVAS.width - Math.ceil(609 * layout.scale / 100)),
      Math.min(y, CANVAS.height - Math.ceil(118 * layout.scale / 100)));
  } else place(node, x, y);
}

function layerSelection() {
  Object.entries(layers).forEach(([key, { node }]) => { node.classList.toggle('is-editable', preview && key === editKey); });
}

function updateBrandCorners() {
  if (!brandCorners.length) return;
  const opacity = state.modules.brand?.opacity ?? 0;
  const brandVisible = !layers.brand.node.hidden && opacity > 0;
  const occupied = [];
  for (const [key, layer] of Object.entries(layers)) {
    const layout = state.modules[key];
    if (layer.node.hidden || !layer.html || !layout?.opacity) continue;
    occupied.push({
      x: Number.parseFloat(layer.node.style.left),
      y: Number.parseFloat(layer.node.style.top),
      width: MODULES[key].w * layout.scale / 100,
      height: MODULES[key].h * layout.scale / 100,
    });
  }
  const cornerText = state.meet?.corner ?? '';
  for (const { node, box, caption } of brandCorners) {
    const bounds = cornerBounds(box, cornerText);
    if (caption.textContent !== cornerText) {
      caption.textContent = cornerText;
      caption.hidden = !cornerText;
      node.style.left = `${bounds.x}px`;
      node.style.width = `${bounds.width}px`;
    }
    node.style.opacity = opacity / 100;
    node.hidden = !showBrandCorner(mode, brandVisible, focusKey, bounds, occupied);
  }
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
  const shown = new Set(Object.keys(layers).filter((key) => {
    const selected = focusKey ? key === focusKey : state.modules[key]?.visible;
    return (key === 'brand' ? showBrandLayer(mode, selected) : selected) && moduleHasContent(key, event);
  }));
  for (const [key, layer] of Object.entries(layers)) {
    const layout = state.modules[key];
    if (!layout) continue;
    const visible = shown.has(key);
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
    const replaced = !visible && replaces[key]?.some((other) => shown.has(other));
    visibility(layer, visible, layout, cut || replaced);
  }
  updateBrandCorners();
}

if (staticPreview) {
  render({
    events: [],
    meet: { accent: '#f5c84b', subtitle: '' },
    modules: { brand: defaultLayout('brand') },
  });
} else {
  new SportsClient({
    role: 'view',
    onState: render,
    onConnection(ready) {
      if (preview) window.parent.postMessage({ type: 'preview:connection', ready }, location.origin);
    },
  });
}

if (preview && !staticPreview) {
  window.addEventListener('message', ({ source, origin, data }) => {
    if (origin !== location.origin || source !== window.parent || data?.type !== 'preview:settings') return;
    stage.classList.toggle('guides', data.guides === true);
    editKey = Object.hasOwn(layers, data.editKey) ? data.editKey : '';
    layerSelection();
    if (data.resetPosition && state) {
      for (const [key, layer] of Object.entries(layers)) placeAtLayout(key, layer.node);
      updateBrandCorners();
    }
  });
  stage.addEventListener('pointerdown', (pointer) => {
    const node = pointer.target.closest('.is-editable');
    if (!state || drag || !node || pointer.button !== 0) return;
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
    updateBrandCorners();
  });
  function endDrag(pointer) {
    if (drag?.pointerId !== pointer.pointerId) return;
    const { key, x, y, eventId, initialX, initialY } = drag;
    drag = undefined;
    if (pointer.type !== 'pointerup') placeAtLayout(key, layers[key].node);
    else if (x !== initialX || y !== initialY) window.parent.postMessage({ type: 'preview:move', key, x, y, eventId }, location.origin);
    updateBrandCorners();
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);
  window.parent.postMessage({ type: 'preview:ready' }, location.origin);
}
