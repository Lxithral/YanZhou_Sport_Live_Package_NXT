export const CANVAS = { width: 1920, height: 1080 };
export const SAFE_AREA = { x: 96, y: 54, padding: 16 };
export const PAGE_SIZE = 6;
export const LINEUP_SIZE = 1;
const MAX_DURATION = 24 * 60 * 60 * 1000;
export const MAX_COMPETITORS = 128;

export const MODULES = {
  brand:   { title: 'Logo 挂角', icon: 'image', corner: 'tl', w: 609, h: 118, visible: true },
  event:   { title: '赛事条', icon: 'list', corner: 'bl', w: 680, h: 112, visible: true },
  score:   { title: '球赛记分牌', icon: 'score', corner: 'tr', w: 660, h: 144, visible: true, kind: 'match' },
  lineup:  { title: '起跑介绍', icon: 'people', x: 240, y: 650, w: 1520, h: 280, visible: false },
  results: { title: '冠军', icon: 'chart', x: 1460, y: 530, w: 340, h: 400, visible: false },
  teams:   { title: '班级积分', icon: 'chart', x: 436, y: 220, w: 1048, h: 636, visible: false },
};

export const KINDS = { track: '径赛', field: '田赛', match: '球赛', ranking: '团体' };
export const DIVISIONS = { men: '男子', women: '女子', open: '公开' };
export const GRADES = { g1: '高一', g2: '高二', staff: '教职工' };
const GENDER_WORD = /男子|女子|男生|女生|男组|女组/u;
export const RESULT_STATUS = { pending: '待录入', ok: '有效', DNS: '未出发', DNF: '未完成', DQ: '取消资格', NM: '无有效成绩' };
export const MOTIONS = { none: '无', fade: '淡入淡出', slide: '下方滑入', side: '左侧滑入', zoom: '缩放' };

export const PRESETS = {
  'run-1000': { name: '1000 米', kind: 'track', distance: 1000, trackLength: 400, legs: 1 },
  'run-800': { name: '800 米', kind: 'track', distance: 800, trackLength: 400, legs: 1 },
  'run-100': { name: '100 米', kind: 'track', distance: 100, trackLength: 400, legs: 1 },
  'run-50': { name: '50 米', kind: 'track', distance: 50, trackLength: 400, legs: 1 },
  'run-200': { name: '200 米', kind: 'track', distance: 200, trackLength: 400, legs: 1 },
  'run-400': { name: '400 米', kind: 'track', distance: 400, trackLength: 400, legs: 1 },
  'run-1500': { name: '1500 米', kind: 'track', distance: 1500, trackLength: 400, legs: 1 },
  'relay-100': { name: '4×100 米接力', kind: 'track', distance: 400, trackLength: 400, legs: 4 },
  'relay-400': { name: '4×400 米接力', kind: 'track', distance: 1600, trackLength: 400, legs: 4 },
  'shuttle-50': { name: '50 米迎面接力', kind: 'track', distance: 500, trackLength: 400, legs: 10 },
  'long-jump': { name: '跳远', kind: 'field' },
  'high-jump': { name: '跳高', kind: 'field' },
  'shot-put': { name: '铅球', kind: 'field' },
  'staff-teams': { name: '教职工团体赛', kind: 'ranking' },
  football: { name: '足球', kind: 'match', homeName: '主队', awayName: '客队', periodLabel: '半场' },
};

export function formatTime(ms, fractions = true, roundUp = false) {
  const centiseconds = Math.max(0, Math.floor(ms / 10));
  const seconds = fractions ? Math.floor(centiseconds / 100) : (roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  const time = `${pad(minutes)}:${pad(seconds % 60)}`;
  return fractions ? `${time}.${pad(centiseconds % 100)}` : time;
}

// 成绩录入不做严格格式检查：常见写法（73.5、1:13.5、1分13秒5、1'13''5）都能识别。
function normalizeScore(source) {
  return String(source).trim()
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/．/g, '.')
    .replace(/：/g, ':')
    .replace(/[’′´]/g, '\'');
}

export function parseTime(source) {
  const value = normalizeScore(source)
    .replace(/分/g, ':')
    .replace(/秒/g, '\'')
    .replace(/'{1,2}/g, ':')
    .replace(/:+$/, '');
  const colon = /^(\d{1,3}):(.+)$/.exec(value);
  const rest = colon ? colon[2] : value;
  const match = /^(\d{1,5})(?:[.:](\d{1,2}))?$/.exec(rest);
  if (!match) throw new Error('这个成绩看不懂，换一种写法试试，例如 73.5、1:13.5 或 1分13秒5。');
  const minutes = colon ? Number(colon[1]) : 0;
  const seconds = Number(match[1]) + (match[2] ? Number(`0.${match[2]}`) : 0);
  const ms = Math.round((minutes * 60 + seconds) * 1000);
  if (ms > MAX_DURATION) throw new Error('时长不能超过 24 小时。');
  return ms;
}

export function parseMark(raw) {
  const value = normalizeScore(raw).replace(/\s*(?:m|米)$/i, '').replace(/^(\d{1,3})米(\d{1,2})$/, '$1.$2');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value) || Number(value) === 0) {
    throw new Error('这个成绩看不懂，换一种写法试试，例如 5.32 或 5米32。');
  }
  return Math.round(Number(value) * 100);
}

export function formatMark(cm) {
  return `${(cm / 100).toFixed(2)} m`;
}

export function activeEvent(state) {
  return state.events.find((event) => event.id === state.activeEventId);
}

export function applicable(key, event) {
  if (key === 'teams') return ['g1', 'g2'].includes(event?.schedule?.grade);
  if (!event) return key === 'brand';
  if (key === 'lineup' && event?.kind === 'match') return false;
  return !MODULES[key].kind || MODULES[key].kind === event?.kind;
}

export function moduleBounds(key, scale) {
  const { w, h } = MODULES[key];
  return { x: CANVAS.width - Math.ceil(w * scale / 100), y: CANVAS.height - Math.ceil(h * scale / 100) };
}

export function safeAnchor(key, requestedScale, corner) {
  const { w, h } = MODULES[key];
  const left = SAFE_AREA.x + SAFE_AREA.padding;
  const top = SAFE_AREA.y + SAFE_AREA.padding;
  const scaleX = Math.floor((CANVAS.width - 2 * left) * 100 / w);
  const scaleY = Math.floor((CANVAS.height - 2 * top) * 100 / h);
  const scale = Math.min(requestedScale, scaleX, scaleY);
  const bounds = moduleBounds(key, scale);
  return { x: corner.endsWith('r') ? bounds.x - left : left, y: corner.startsWith('b') ? bounds.y - top : top, scale };
}

export function modulePosition(key, { x, y, scale }) {
  const bounds = moduleBounds(key, scale);
  return { x: clamp(x, 0, bounds.x), y: clamp(y, 0, bounds.y) };
}

export function moduleScaleLimit(key) {
  const { w, h } = MODULES[key];
  return Math.min(180, Math.floor(100 * Math.min(CANVAS.width / w, CANVAS.height / h)));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function defaultLayout(key) {
  const { visible, corner, x, y, scale = 100 } = MODULES[key];
  const position = corner ? safeAnchor(key, scale, corner) : { x, y, scale };
  return { visible, ...position, opacity: 100, enter: 'fade', exit: 'fade', duration: 260 };
}

export function resultValue(athlete, event) {
  if (athlete.status !== 'ok') return null;
  if (event.kind !== 'field') return athlete.time;
  const clears = athlete.jumps?.filter(({ outcome }) => outcome === 'O').map(({ height }) => height) ?? [];
  return Math.max(0, ...athlete.attempts.filter(Number.isInteger), ...clears) || null;
}

export function resultText(athlete, event) {
  const value = resultValue(athlete, event);
  if (value !== null) return event.kind === 'field' ? formatMark(value) : formatTime(value);
  return athlete.status === 'pending' ? '—' : athlete.status;
}

export function roster(event) {
  return [...event.competitors].sort((a, b) => (a.heat ?? 1) - (b.heat ?? 1) || (a.lane || Infinity) - (b.lane || Infinity));
}

export function heats(event) {
  return [...new Set([event.heat ?? 1, 1, ...event.competitors.map((athlete) => athlete.heat ?? 1)])].sort((a, b) => a - b);
}

export function lineupRoster(event) {
  const rows = roster(event);
  return event.kind === 'track' ? rows.filter((athlete) => (athlete.heat ?? 1) === (event.heat ?? 1)) : rows;
}

export function jumpHeight(event) {
  return event.barHeight ?? (event.division === 'women' ? 95 : 130);
}

export function nextJumpHeight(event) {
  const height = jumpHeight(event);
  return height + (height < (event.division === 'women' ? 115 : 150) ? 5 : 3);
}

export function jumpFailures(athlete) {
  let failures = 0;
  for (const { outcome } of (athlete.jumps ?? []).toReversed()) {
    if (outcome === 'O') break;
    if (outcome === 'X') failures++;
  }
  return failures;
}

export function canJump(event, athlete) {
  const jumps = athlete.jumps ?? [];
  const bar = jumpHeight(event);
  const last = jumps.at(-1);
  return canRank(athlete) && jumpFailures(athlete) < 3 && (!last || bar > last.height || (bar === last.height && last.outcome === 'X'));
}

export function canRank(athlete) {
  return athlete.status === 'ok' || athlete.status === 'pending';
}

export function relayRegistration(athlete) {
  if (athlete.boys == null || athlete.girls == null) return '待核验';
  return athlete.boys === 5 && athlete.girls === 5 ? '5 男 / 5 女' : '人数不符';
}

function compareMarks(a, b, event) {
  if (a.value !== b.value) return (a.value - b.value) * (event.kind === 'field' ? -1 : 1);
  if (event.schedule?.project !== 'high-jump') return 0;
  const faults = ({ athlete, value }) => {
    const jumps = athlete.jumps ?? [];
    if (!jumps.some(({ height, outcome }) => height === value && outcome === 'O')) return [Infinity, Infinity];
    const misses = jumps.filter(({ height, outcome }) => outcome === 'X' && height <= value);
    return [misses.filter(({ height }) => height === value).length, misses.length];
  };
  const first = faults(a);
  const second = faults(b);
  return first[0] - second[0] || first[1] - second[1] || 0;
}

export function standings(event) {
  const rows = roster(event).map((athlete) => ({ athlete, value: resultValue(athlete, event), rank: null }));
  if (event.rankOrder) {
    const places = new Map(event.rankOrder.map((id, index) => [id, index + 1]));
    for (const row of rows) row.rank = places.get(row.athlete.id) ?? null;
    return rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  }
  rows.sort((a, b) => {
    if (a.value !== null && b.value !== null) return compareMarks(a, b, event);
    if (a.value !== null) return -1;
    if (b.value !== null) return 1;
    return Number(a.athlete.status === 'pending') - Number(b.athlete.status === 'pending');
  });
  rows.forEach((row, i) => {
    if (row.value !== null) row.rank = i && compareMarks(rows[i - 1], row, event) === 0 ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

export function resultRows(event) {
  return standings(event).filter(({ athlete, rank }) => rank !== null || !canRank(athlete));
}

export function paginatedCount(event, key) {
  if (event.kind === 'match') return 1;
  const count = key === 'results' ? resultRows(event).length : lineupRoster(event).length;
  const size = key === 'lineup' ? LINEUP_SIZE : PAGE_SIZE;
  return Math.max(1, Math.ceil(count / size));
}

export function eventTitle(event) {
  const grade = event.schedule?.grade;
  return [event.name, grade === 'staff' ? '' : GRADES[grade], eventStage(event)].filter(Boolean).join(' · ');
}

export function inferDivision(...labels) {
  for (const label of labels) {
    if (/混合|混双|公开/u.test(label)) return 'open';
    const group = GENDER_WORD.exec(label)?.[0];
    if (group) return group.startsWith('男') ? 'men' : 'women';
  }
  return 'open';
}

export function eventRound(stage) {
  return stage.replace(GENDER_WORD, '').trim();
}

function projectName(name) {
  return name.replace(GENDER_WORD, '').replace(/\s/g, '').replace(/^(\d+)米$/u, '$1m').toLowerCase();
}

export function sameProject(first, second) {
  return first.kind === second.kind && projectName(first.name) === projectName(second.name);
}

export function eventStage({ division, stage }) {
  if (division !== 'men' && division !== 'women') return stage;
  const label = DIVISIONS[division];
  return GENDER_WORD.test(stage) ? stage.replace(GENDER_WORD, label) : label + stage;
}

export function periodTitle(event) {
  if (event.periodLabel === '半场') return ['上半场', '下半场'][event.score.period - 1] || `加时 ${event.score.period - 2}`;
  return `第 ${event.score.period} ${event.periodLabel}`;
}
