import { randomUUID } from 'node:crypto';
import {
  DIVISIONS, GRADES, KINDS, MAX_COMPETITORS, MODULES, MOTIONS, PRESETS, activeEvent, applicable,
  canJump, canRank, clamp, defaultLayout, eventStage, inferDivision,
  jumpFailures, jumpHeight, moduleBounds, moduleScaleLimit, nextJumpHeight, paginatedCount, parseMark, parseTime, relayRegistration, standings,
} from '../public/sport.js';
import { AWARD_LIMIT, SCHOOL_RACES, canScore, className, classStandings, finalFor, topRows } from '../public/meet-program.js';

const LEGACY_PRESET_IDS = new Set(['run-1000', 'run-800', 'run-100', 'relay-100', 'long-jump', 'shot-put', 'run-1500']
  .flatMap((id) => [id, `${id}-women`]));
const LEGACY_DEFAULT_ORIGINS = { brand: [48, 34], event: [48, 931], score: [1212, 34] };
const STATE_VERSION = 9;
const BOARD_KEYS = ['lineup', 'results'];
const TABLE_KEYS = [...BOARD_KEYS, 'teams'];
const SPECIAL = ['DNS', 'DNF', 'DQ', 'NM'];
const MAX_EVENTS = 160;
const MAX_ATTEMPTS = 12;
const MAX_HEATS = 32;
const RESULT_COMMANDS = new Set(['athlete:save', 'athlete:delete', 'athlete:attempt', 'rank:move', 'rank:remove', 'rank:reset', 'rank:champion', 'jump:mark', 'jump:undo']);

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function text(value, max, label, required = false) {
  requireThat(typeof value === 'string' || value === undefined || value === null, `${label}应为文字。`);
  const clean = (value ?? '').trim().replace(/[\s\u0000-\u001f]+/g, ' ');
  requireThat(clean.length <= max, `${label}最多 ${max} 个字符。`);
  if (required) requireThat(clean, `请填写${label}。`);
  return clean;
}

function integer(value, min, max, label) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  requireThat(Number.isInteger(number) && number >= min && number <= max, `${label}应为 ${min} 至 ${max} 的整数。`);
  return number;
}

function scoreStart() {
  return { home: 0, away: 0, period: 1 };
}

function defaultGraphics() {
  return {
    meet: { title: '烟洲体育', subtitle: '', accent: '#f5c84b' },
    modules: Object.fromEntries(Object.keys(MODULES).map((key) => [key, defaultLayout(key)])),
    pages: { lineup: 0, results: 0 },
  };
}

function newEvent(fields, id = randomUUID()) {
  return { ...fields, id, competitors: [], score: scoreStart(), graphics: defaultGraphics() };
}

function schoolEvents() {
  return SCHOOL_RACES.map(({ id, ...fields }) => newEvent(structuredClone(fields), id));
}

export function initialState() {
  const events = schoolEvents();
  return { version: STATE_VERSION, revision: 0, activeEventId: events[0].id, events, standby: defaultGraphics() };
}

function validGraphics(config, version) {
  return typeof config?.meet?.title === 'string' && typeof config.meet.subtitle === 'string' && /^#[0-9a-f]{6}$/i.test(config.meet.accent) &&
    object(config.pages) &&
    Object.keys(MODULES).every((key) => {
      if (key === 'teams' && version < 4) return true;
      const layout = config.modules?.[key];
      return typeof layout?.visible === 'boolean' && ['x', 'y', 'scale', 'opacity', 'duration'].every((field) => Number.isInteger(layout[field])) &&
        Object.hasOwn(MOTIONS, layout.enter) && Object.hasOwn(MOTIONS, layout.exit);
    });
}

function validStart(start) {
  if (start === '') return true;
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start)) return false;
  const date = new Date(`${start}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === start;
}

export function verifyState(value) {
  requireThat(object(value) && Number.isInteger(value.version) && value.version >= 1 && value.version <= STATE_VERSION && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    validGraphics(value.version >= 3 ? value.standby : value, value.version) && Array.isArray(value.events) &&
    value.events.length <= (value.version >= 4 ? MAX_EVENTS : 96), '设置文件格式不正确。');
  const ids = new Set();
  for (const event of value.events) {
    requireThat(typeof event?.id === 'string' && !ids.has(event.id) && typeof event.name === 'string' && typeof event.stage === 'string' &&
      Object.hasOwn(KINDS, event.kind) && Array.isArray(event.competitors) && object(event.score), '赛事设置记录损坏。');
    if (value.version >= 3) {
      requireThat(Object.hasOwn(DIVISIONS, event.division) && validGraphics(event.graphics, value.version) &&
        BOARD_KEYS.every((key) => Number.isInteger(event.graphics.pages[key]) && event.graphics.pages[key] >= 0), '赛事包装配置损坏。');
    }
    if (event.schedule !== undefined) {
      requireThat(object(event.schedule), '赛事排期记录损坏。');
      const { grade, project, round, start } = event.schedule;
      requireThat(Object.hasOwn(GRADES, grade) && PRESETS[project]?.kind === event.kind && ['heat', 'final', 'pending'].includes(round) &&
        validStart(start), '赛事排期记录损坏。');
    }
    if (event.kind === 'track') {
      requireThat(Number.isInteger(event.distance) && event.distance > 0 && Number.isInteger(event.trackLength) && event.trackLength >= 50 &&
        Number.isInteger(event.legs) && event.legs >= 1 && event.legs <= 12 && event.distance / event.trackLength <= 50, '径赛设置记录损坏。');
    }
    if (event.kind === 'match') {
      requireThat(['home', 'away', 'period'].every((key) => Number.isInteger(event.score[key])), '球赛设置记录损坏。');
    }
    requireThat(event.competitors.every((athlete) => typeof athlete?.id === 'string' && typeof athlete.name === 'string' &&
      Array.isArray(athlete.attempts) && (athlete.time === null || Number.isFinite(athlete.time))), '参赛名单记录损坏。');
    if (event.rankOrder !== undefined) {
      const eligible = new Set(event.competitors.filter(canRank).map(({ id }) => id));
      requireThat(event.kind !== 'match' && Array.isArray(event.rankOrder) && new Set(event.rankOrder).size === event.rankOrder.length &&
        event.rankOrder.every((id) => eligible.has(id)), '手动排名记录损坏。');
    }
    ids.add(event.id);
  }
  requireThat(value.events.length ? ids.has(value.activeEventId) : value.activeEventId === null, '当前赛事记录损坏。');
  return value;
}

function migrateLegacyGraphics(state) {
  const { meet, pages } = state;
  // 旧版本把人物条、公告等模块的布局放在顶层，这里只保留仍然存在的模块。
  const known = (source) => Object.fromEntries(Object.keys(MODULES).map((key) => [key, structuredClone(source?.[key] ?? defaultLayout(key))]));
  const current = { meet, modules: known(state.modules), pages };
  const template = { ...defaultGraphics(), meet: structuredClone(meet), modules: known(state.modules) };
  for (const key of ['lineup', 'results']) template.modules[key].visible = false;
  const events = state.events
    .filter((event) => state.version === 2 || (event.id !== 'basketball' && !(event.kind === 'match' && event.name.trim() === '篮球')))
    .map((event) => {
      const division = inferDivision(event.stage, event.name);
      const graphics = structuredClone(event.id === state.activeEventId ? current : template);
      const updated = { ...event, division, graphics };
      clampBoardPages(updated);
      return updated;
    });
  const activeEventId = events.some((event) => event.id === state.activeEventId) ? state.activeEventId : events[0]?.id ?? null;
  return { ...state, events, activeEventId, standby: state.activeEventId === null ? structuredClone(current) : template };
}

function hasRaceData(event) {
  return event.competitors.length > 0;
}

function migrateSchoolEvents(state) {
  const { events, standby, activeEventId } = state.version >= 3 ? state : migrateLegacyGraphics(state);
  let updated = events.filter((event) => event.schedule || !LEGACY_PRESET_IDS.has(event.id) || hasRaceData(event));
  let outputSettings = standby;
  if (state.version < 4) {
    const addPointsLayer = (graphics) => ({ ...graphics, modules: { ...graphics.modules, teams: defaultLayout('teams') } });
    updated = updated.map((event) => ({ ...event, graphics: addPointsLayer(event.graphics) }));
    const ids = new Set(updated.map(({ id }) => id));
    updated.push(...schoolEvents().filter(({ id }) => !ids.has(id)));
    outputSettings = addPointsLayer(standby);
  }
  const selectionId = activeEventId;
  const selection = updated.find(({ id }) => id === selectionId) ?? updated.find((event) => event.schedule) ?? updated[0];
  const selected = selection?.id ?? null;
  return { events: updated, activeEventId: selected, standby: outputSettings };
}

function migrateDefaultPositions(graphics) {
  const modules = { ...graphics.modules };
  for (const [key, [oldX, oldY]] of Object.entries(LEGACY_DEFAULT_ORIGINS)) {
    const layout = modules[key];
    if (!layout) continue;
    if (layout.x !== oldX || layout.y !== oldY || layout.scale !== 100) continue;
    const { x, y, scale } = defaultLayout(key);
    modules[key] = { ...layout, x, y, scale };
  }
  return { ...graphics, modules };
}

function stripClockModule(graphics) {
  const { clock, ...modules } = graphics.modules;
  return { ...graphics, modules };
}

function stripTiming(event) {
  const { clock, splits, heatRuns, clockMode, periodMinutes, ...rest } = event;
  return { ...rest, graphics: stripClockModule(event.graphics) };
}

function migrateIntroLayouts(graphics, version) {
  const modules = { ...graphics.modules };
  const reset = (key, x, y, scale = 100) => {
    const layout = modules[key];
    if (!layout || layout.x !== x || layout.y !== y || layout.scale !== scale) return;
    modules[key] = { ...defaultLayout(key), visible: layout.visible, opacity: layout.opacity, enter: layout.enter, exit: layout.exit, duration: layout.duration };
  };
  if (version < 8) {
    reset('lineup', 530, 150);
    reset('results', 560, 380);
  }
  reset('lineup', 120, 690);
  reset('results', 1380, 380);
  return { ...graphics, modules };
}

function pruneModules(graphics) {
  // 只保留当前仍在使用的模块，旧版本留下的人物条、公告等布局在这里清掉。
  const modules = Object.fromEntries(Object.keys(MODULES).map((key) => [key, graphics.modules?.[key] ?? defaultLayout(key)]));
  return { meet: graphics.meet, modules, pages: graphics.pages };
}

export function migrateState(state) {
  if (state.version === STATE_VERSION) return state;
  const { events, activeEventId, standby } = state.version < 5 ? migrateSchoolEvents(state) : state;
  const timingDropped = state.version < 7;
  const upgrade = (graphics) => {
    const positioned = migrateIntroLayouts(graphics, state.version);
    return pruneModules(state.version < 8 ? migrateDefaultPositions(positioned) : positioned);
  };
  return {
    version: STATE_VERSION, revision: state.revision + 1, activeEventId,
    events: (timingDropped ? events.map(stripTiming) : events).map((event) => ({ ...event, graphics: upgrade(event.graphics) })),
    standby: upgrade(timingDropped ? stripClockModule(standby) : standby),
  };
}

export function clientState(state, onAir) {
  const event = activeEvent(state);
  const events = onAir ? (event ? [event] : []) : state.events;
  return {
    version: state.version, revision: state.revision, activeEventId: state.activeEventId,
    ...graphicsForActive(state),
    events: events.map(({ graphics, ...details }) => onAir ? { ...details, stage: eventStage(details) } : details),
    ...(onAir ? {
      eventNumber: event ? state.events.indexOf(event) + 1 : 0,
      classBoard: event?.graphics.modules.teams?.visible ? classStandings(state.events)[event.schedule?.grade]?.slice(0, AWARD_LIMIT) : [],
    } : {}),
  };
}

function getEvent(state, id) {
  const event = state.events.find((candidate) => candidate.id === id);
  requireThat(event, '该赛事已不存在，请重新选择。');
  return event;
}

function getAthlete(event, id) {
  const athlete = event.competitors.find((candidate) => candidate.id === id);
  requireThat(athlete, '该选手已不存在，请重新选择。');
  return athlete;
}

function graphicsForActive(state, eventId) {
  requireThat(eventId === undefined || eventId === state.activeEventId, '当前赛事已切换，请核对后再操作。');
  return activeEvent(state)?.graphics ?? state.standby;
}

function readEvent(fields, existing) {
  requireThat(object(fields), '赛事数据格式不正确。');
  const { kind } = fields;
  requireThat(Object.hasOwn(KINDS, kind), '请选择赛事类别。');
  const name = text(fields.name, 28, '项目名称', true);
  const stage = text(fields.stage, 24, '组次或轮次');
  const division = fields.division ?? existing?.division ?? inferDivision(stage, name);
  requireThat(Object.hasOwn(DIVISIONS, division), '请选择男子、女子或公开组。');
  const info = { kind, division, name, stage, venue: text(fields.venue, 38, '赛场') };
  if (kind === 'track') {
    const distance = integer(fields.distance, 10, 30000, '总距离');
    const trackLength = integer(fields.trackLength, 50, 1000, '跑道每圈长度');
    const legs = integer(fields.legs, 1, 12, '棒数');
    requireThat(distance / trackLength <= 50 && distance % legs === 0, '请填写可整除棒数的距离，每项最多 50 圈。');
    return { ...info, distance, trackLength, legs };
  }
  if (kind === 'match') {
    requireThat(['节', '半场', '局'].includes(fields.periodLabel), '请选择节次单位。');
    return { ...info, homeName: text(fields.homeName, 18, '主队', true), awayName: text(fields.awayName, 18, '客队', true),
      periodLabel: fields.periodLabel };
  }
  return info;
}

function saveEvent(state, { id, fields, activate: takeLive = true }) {
  const event = id ? getEvent(state, id) : null;
  const info = readEvent(fields, event);
  if (!event) {
    requireThat(state.events.length < MAX_EVENTS, `最多可创建 ${MAX_EVENTS} 项赛事。`);
    const event = newEvent(info);
    state.events.push(event);
    if (takeLive || state.activeEventId === null) state.activeEventId = event.id;
    return;
  }
  requireThat(event.kind === info.kind, '已创建的赛事类别固定，可新建其他类别。');
  if (event.schedule) {
    requireThat(event.division === info.division, '本届赛程的组别固定，请选对应组别的赛事。');
    const start = fields.start ?? event.schedule.start;
    requireThat(validStart(start), '请输入有效的比赛时间。');
    event.schedule.start = start;
  }
  Object.assign(event, info);
}

function readAttempt(value) {
  const raw = String(value).trim().toUpperCase();
  return ['X', '-'].includes(raw) ? raw : parseMark(raw);
}

function optionalInteger(value, min, max, label) {
  return value === '' || value == null ? null : integer(value, min, max, label);
}

function readJumps(value) {
  const series = text(value, 1400, '跳高记录');
  if (!series) return [];
  const jumps = [];
  for (const entry of series.split('|')) {
    const match = /^(\d{2,3}):([OX-])$/.exec(entry.trim().toUpperCase());
    requireThat(match, '跳高记录用「95:O|100:X」格式。');
    const height = integer(match[1], 50, 300, '横杆高度');
    const last = jumps.at(-1);
    requireThat(!last || (height > last.height || (height === last.height && last.outcome === 'X')), '跳高记录须按高度顺序填写。');
    requireThat(jumpFailures({ jumps }) < 3, '连续三次失败后结束试跳。');
    jumps.push({ height, outcome: match[2] });
  }
  return jumps;
}

function jumpStatus({ jumps, attempts }) {
  if (attempts.some(Number.isInteger) || jumps.some(({ outcome }) => outcome === 'O')) return 'ok';
  return jumpFailures({ jumps }) >= 3 ? 'NM' : 'pending';
}

function readAthlete(fields, event, id = randomUUID()) {
  requireThat(object(fields), '选手数据格式不正确。');
  const { kind, schedule } = event;
  const lane = optionalInteger(fields.lane, 1, 999, '道次或出场序');
  const result = text(fields.result, 24, '成绩');
  const explicit = text(fields.status, 12, '状态');
  requireThat(['', 'ok', 'pending', ...SPECIAL].includes(explicit), '成绩状态应为 ok、pending、DNS、DNF、DQ 或 NM。');
  let attempts = [];
  let time = null;
  const jumps = schedule?.project === 'high-jump' ? readJumps(fields.jumps) : [];
  if (kind === 'field') {
    const list = text(fields.attempts, 128, '试次');
    if (list) attempts = list.split(/[|,，]/).map(readAttempt);
    else if (!jumps.length && result && !SPECIAL.includes(result.toUpperCase())) attempts = [parseMark(result)];
    requireThat(attempts.length <= MAX_ATTEMPTS, `最多记录 ${MAX_ATTEMPTS} 次试次。`);
  } else if (kind === 'track' && result && !SPECIAL.includes(result.toUpperCase())) time = parseTime(result);
  const inferred = kind === 'field' ? (attempts.some(Number.isInteger) ? 'ok' : attempts.length ? 'NM' : 'pending') : (time === null ? 'pending' : 'ok');
  const assumed = SPECIAL.includes(result.toUpperCase()) ? result.toUpperCase() : (jumps.length ? jumpStatus({ jumps, attempts }) : inferred);
  const status = SPECIAL.includes(explicit) ? explicit : assumed;
  if (kind === 'track' && status !== 'ok') time = null;
  const athlete = { id, lane, bib: text(fields.bib, 14, '号码'), name: text(fields.name, 30, '姓名或队名', true), team: text(fields.team, 35, '单位'), status, time, attempts };
  if (kind === 'track' && schedule) athlete.heat = optionalInteger(fields.heat, 1, MAX_HEATS, '分组') ?? 1;
  if (schedule?.project === 'shuttle-50') {
    athlete.boys = optionalInteger(fields.boys, 0, 99, '男生人数');
    athlete.girls = optionalInteger(fields.girls, 0, 99, '女生人数');
  }
  if (jumps.length) athlete.jumps = jumps;
  return athlete;
}

function ensureRoster(rows) {
  requireThat(rows.length <= MAX_COMPETITORS, `每项赛事最多 ${MAX_COMPETITORS} 位选手。`);
  const bibs = new Set();
  for (const athlete of rows) {
    const key = athlete.bib.toLowerCase();
    if (!key) continue;
    requireThat(!bibs.has(key), `号码「${athlete.bib}」重复。`);
    bibs.add(key);
  }
}

function getRosterEvent(state, eventId) {
  const event = getEvent(state, eventId);
  requireThat(event.kind !== 'match', '请在记分区操作球赛。');
  return event;
}

function saveModule(state, { key, patch, eventId }) {
  requireThat(Object.hasOwn(MODULES, key) && object(patch), '包装模块不存在。');
  const { modules, pages } = graphicsForActive(state, eventId);
  const layout = modules[key];
  if (Object.hasOwn(patch, 'visible')) {
    requireThat(typeof patch.visible === 'boolean', '请指定显隐状态。');
    const event = activeEvent(state);
    if (patch.visible) {
      requireThat(applicable(key, event), '当前赛事不适用这个模块。');
      if (key === 'lineup') modules.event.visible = false;
      if (key === 'event') modules.lineup.visible = false;
      if (TABLE_KEYS.includes(key)) {
        for (const other of TABLE_KEYS) if (other !== key) modules[other].visible = false;
        if (key === 'results') pages.results = 0;
      }
    }
    layout.visible = patch.visible;
  }
  if (Object.hasOwn(patch, 'scale')) layout.scale = integer(patch.scale, 35, moduleScaleLimit(key), '缩放');
  if (Object.hasOwn(patch, 'opacity')) layout.opacity = integer(patch.opacity, 0, 100, '透明度');
  const bounds = moduleBounds(key, layout.scale);
  for (const [axis, max] of Object.entries(bounds)) {
    const input = Object.hasOwn(patch, axis) ? integer(patch[axis], 0, axis === 'x' ? 1920 : 1080, `位置 ${axis.toUpperCase()}`) : layout[axis];
    layout[axis] = clamp(input, 0, max);
  }
  for (const key of ['enter', 'exit']) {
    if (!Object.hasOwn(patch, key)) continue;
    requireThat(Object.hasOwn(MOTIONS, patch[key]), '动画类型无效。');
    layout[key] = patch[key];
  }
  if (Object.hasOwn(patch, 'duration')) layout.duration = integer(patch.duration, 80, 2000, '动画时长');
}

function pruneRanks(event) {
  if (!event.rankOrder) return;
  const eligible = new Set(event.competitors.filter(canRank).map(({ id }) => id));
  event.rankOrder = event.rankOrder.filter((id) => eligible.has(id));
}

function clampBoardPages(event) {
  const pages = event.graphics.pages;
  for (const key of BOARD_KEYS) {
    const page = pages[key];
    if (!Number.isInteger(page) || page < 0) pages[key] = 0;
    else if (page > 0) pages[key] = Math.min(page, paginatedCount(event, key) - 1);
  }
}

function moveRank(state, { eventId, id, beforeId = null }) {
  const event = getRosterEvent(state, eventId);
  requireThat(canRank(getAthlete(event, id)), '该选手的成绩状态不能排入名次。');
  const order = standings(event).filter(({ rank }) => rank !== null).map(({ athlete }) => athlete.id);
  if (beforeId === id) return;
  const next = order.filter((placed) => placed !== id);
  const position = beforeId === null ? next.length : next.indexOf(beforeId);
  requireThat(position >= 0, '目标名次已变化，请核对后再拖动。');
  next.splice(position, 0, id);
  event.rankOrder = next;
}

const commands = {
  'event:save': saveEvent,
  'event:select'(state, { eventId }) { state.activeEventId = getEvent(state, eventId).id; },
  'event:delete'(state, { eventId }) {
    const index = state.events.indexOf(getEvent(state, eventId));
    state.events.splice(index, 1);
    if (state.activeEventId === eventId) state.activeEventId = (state.events[index] ?? state.events[index - 1])?.id ?? null;
  },
  'round:qualify'(state, { eventId }) {
    const event = getEvent(state, eventId);
    const final = finalFor(state.events, event);
    requireThat(final, '找不到对应的决赛。');
    requireThat(!final.competitors.length, '决赛已有名单，请在备赛名单中核对。');
    const rows = topRows(event);
    requireThat(rows.length && rows.length <= AWARD_LIMIT, '请先确认前八名，晋级线并列时按裁判结果调整名次。');
    final.competitors = rows.map(({ athlete }) => readAthlete({ name: athlete.name, bib: athlete.bib, team: athlete.team }, final));
  },
  'points:confirm'(state, { eventId, scored }) {
    const event = getEvent(state, eventId);
    requireThat(canScore(event), '只有学生组决赛可计入团体分。');
    requireThat(typeof scored === 'boolean', '请选择是否计分。');
    if (scored) {
      const rows = topRows(event);
      requireThat(rows.length && new Set(rows.map(({ rank }) => rank)).size === rows.length, '请先按裁判结果确认有效名次和并列处理。');
      requireThat(rows.every(({ athlete }) => className(event, athlete)), '请给前八名填写单位或班级后再确认。');
      if (event.schedule.project === 'shuttle-50') requireThat(rows.every(({ athlete }) => relayRegistration(athlete) !== '人数不符'), '有队伍人数不符，请核验或按裁判结果取消资格。');
    }
    event.schedule.scored = scored;
  },
  'athlete:save'(state, { eventId, id, fields }) {
    const event = getRosterEvent(state, eventId);
    if (id) getAthlete(event, id);
    const athlete = readAthlete(fields, event, id || undefined);
    event.competitors = id ? event.competitors.map((row) => row.id === id ? athlete : row) : [...event.competitors, athlete];
    ensureRoster(event.competitors);
    pruneRanks(event);
  },
  'athlete:delete'(state, { eventId, id }) {
    const event = getRosterEvent(state, eventId);
    getAthlete(event, id);
    event.competitors = event.competitors.filter((athlete) => athlete.id !== id);
    pruneRanks(event);
  },
  'athlete:attempt'(state, { eventId, id, value, index }) {
    const event = getRosterEvent(state, eventId);
    const athlete = getAthlete(event, id);
    requireThat(event.kind === 'field' && event.schedule?.project !== 'high-jump', '请用本项目的试次记录方式。');
    requireThat(['pending', 'ok', 'NM'].includes(athlete.status), '请先在选手编辑中更新成绩状态。');
    requireThat(index === athlete.attempts.length && index < MAX_ATTEMPTS, '试次已更新或已满，请核对选手编辑。');
    athlete.attempts.push(readAttempt(value));
    athlete.status = athlete.attempts.some(Number.isInteger) ? 'ok' : 'NM';
    pruneRanks(event);
  },
  'jump:raise'(state, { eventId, height }) {
    const event = getRosterEvent(state, eventId);
    requireThat(event.schedule?.project === 'high-jump' && height === jumpHeight(event), '横杆高度已经变化，请核对。');
    event.barHeight = integer(nextJumpHeight(event), 50, 300, '横杆高度');
  },
  'jump:mark'(state, { eventId, id, height, outcome, index }) {
    const event = getRosterEvent(state, eventId);
    const athlete = getAthlete(event, id);
    requireThat(event.schedule?.project === 'high-jump' && height === jumpHeight(event), '横杆高度已经变化，请核对。');
    requireThat(['O', 'X', '-'].includes(outcome) && index === (athlete.jumps?.length ?? 0) && canJump(event, athlete), '该选手本高度的试跳已更新或已结束。');
    (athlete.jumps ??= []).push({ height, outcome });
    athlete.status = jumpStatus(athlete);
    pruneRanks(event);
  },
  'jump:undo'(state, { eventId, id, index }) {
    const event = getRosterEvent(state, eventId);
    const athlete = getAthlete(event, id);
    requireThat(event.schedule?.project === 'high-jump' && index > 0 && athlete.jumps?.length === index &&
      ['pending', 'ok', 'NM'].includes(athlete.status), '试跳或选手状态已经变化，请核对。');
    athlete.jumps.pop();
    athlete.status = jumpStatus(athlete);
    pruneRanks(event);
  },
  'rank:move': moveRank,
  'rank:champion'(state, { eventId, id }) {
    const event = getRosterEvent(state, eventId);
    requireThat(canRank(getAthlete(event, id)), '该选手的成绩状态不能排入名次。');
    event.rankOrder = [id];
  },
  'rank:remove'(state, { eventId, id }) {
    const event = getRosterEvent(state, eventId);
    getAthlete(event, id);
    event.rankOrder = standings(event).filter(({ athlete, rank }) => rank !== null && athlete.id !== id).map(({ athlete }) => athlete.id);
  },
  'rank:reset'(state, { eventId }) { delete getRosterEvent(state, eventId).rankOrder; },
  'match:score'(state, { eventId, side, delta }) {
    const event = getEvent(state, eventId);
    requireThat(event.kind === 'match' && ['home', 'away'].includes(side) && [-1, 1, 2, 3].includes(delta), '记分操作无效。');
    event.score[side] = clamp(event.score[side] + delta, 0, 999);
  },
  'match:period'(state, { eventId, period }) {
    const event = getEvent(state, eventId);
    requireThat(event.kind === 'match', '记分操作无效。');
    const next = integer(period, 1, 30, '节次');
    event.score.period = next;
  },
  'module:save': saveModule,
  'module:reset'(state, { key, eventId }) {
    requireThat(Object.hasOwn(MODULES, key), '包装模块不存在。');
    const { modules } = graphicsForActive(state, eventId);
    modules[key] = { ...defaultLayout(key), visible: modules[key].visible };
  },
  'module:clear'(state, { eventId }) {
    const { modules } = graphicsForActive(state, eventId);
    Object.values(modules).forEach((layout) => { layout.visible = false; });
  },
  'module:base'(state, { eventId }) {
    const { modules } = graphicsForActive(state, eventId);
    Object.entries(modules).forEach(([key, layout]) => { layout.visible = MODULES[key].visible; });
  },
  'page:set'(state, { key, page, eventId }) {
    requireThat(BOARD_KEYS.includes(key), '翻页模块无效。');
    const { pages } = graphicsForActive(state, eventId);
    const event = activeEvent(state);
    requireThat(event, '请先选择赛事。');
    pages[key] = integer(page, 0, paginatedCount(event, key) - 1, '页码');
  },
  'meet:save'(state, { title, subtitle, accent, eventId }) {
    requireThat(typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent), '请选择有效的包装强调色。');
    graphicsForActive(state, eventId).meet = { title: text(title, 20, '榜单页脚', true), subtitle: text(subtitle, 24, '挂角副标题'), accent };
  },
  'modules:brand-only'(state, { eventId }) {
    const graphics = graphicsForActive(state, eventId);
    for (const [key, layout] of Object.entries(graphics.modules)) layout.visible = key === 'brand';
    graphics.pages.lineup = 0;
    graphics.pages.results = 0;
  },
};

export function applyCommand(state, command, now) {
  requireThat(object(command) && Object.hasOwn(commands, command.action), '无法识别的操作。');
  const draft = structuredClone(state);
  commands[command.action](draft, command, now);
  if (RESULT_COMMANDS.has(command.action)) {
    const schedule = getEvent(draft, command.eventId).schedule;
    if (schedule) delete schedule.scored;
  }
  for (const event of draft.events) clampBoardPages(event);
  draft.revision++;
  return draft;
}
