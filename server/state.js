import { randomUUID } from 'node:crypto';
import {
  DIVISIONS, GRADES, KINDS, MAX_COMPETITORS, MAX_TIME, MODULES, MOTIONS, PRESETS, activeEvent, applicable, blankClock,
  canJump, canRank, checkpoints, clamp, clockPhase, defaultLayout, elapsedTime, eventStage, heats, inferDivision,
  jumpFailures, jumpHeight, moduleBounds, moduleScaleLimit, nextJumpHeight, paginatedCount, parseMark, parseTime, relayRegistration, standings,
} from '../public/sport.js';
import { AWARD_LIMIT, SCHOOL_RACES, canScore, className, classStandings, finalFor, topRows } from '../public/meet-program.js';

const LEGACY_PRESET_IDS = new Set(['run-1000', 'run-800', 'run-100', 'relay-100', 'long-jump', 'shot-put', 'run-1500']
  .flatMap((id) => [id, `${id}-women`]));
const REHEARSAL_RACE = 'school-g1-men-run-1000-final';
const REHEARSAL_LONG_JUMP = 'school-g1-men-long-jump-final';
const REHEARSAL_TARGETS = new Map([['run-1000', REHEARSAL_RACE], ['long-jump', REHEARSAL_LONG_JUMP]]);
const BOARD_KEYS = ['lineup', 'results'];
const TABLE_KEYS = [...BOARD_KEYS, 'teams'];
const SPECIAL = ['DNS', 'DNF', 'DQ', 'NM'];
const MAX_EVENTS = 160;
const MAX_ATTEMPTS = 12;
const MAX_HEATS = 32;
const RESULT_COMMANDS = new Set(['athlete:save', 'athlete:delete', 'athlete:finish', 'athlete:attempt', 'athlete:import', 'rank:move', 'rank:remove', 'rank:reset', 'jump:mark', 'jump:undo']);

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
    athlete: { name: '', detail: '', tag: '' }, notice: { title: '赛事公告', body: '' },
  };
}

function newEvent(fields, id = randomUUID()) {
  return { ...fields, id, competitors: [], clock: blankClock(), splits: [], score: scoreStart(), graphics: defaultGraphics() };
}

function schoolEvents() {
  return SCHOOL_RACES.map(({ id, ...fields }) => newEvent(structuredClone(fields), id));
}

export function initialState(demo = false) {
  const events = schoolEvents();
  if (demo) {
    events.find(({ id }) => id === REHEARSAL_RACE).competitors = ['林浩宇', '陈子航', '陆晨曦', '吴思远', '苏乐扬', '张铭轩', '周予安', '韩东辰']
      .map((name, i) => ({ id: `demo-${i + 1}`, name, lane: i + 1, bib: String(101 + i), team: `${i + 1}班`, time: null, attempts: [], status: 'pending', heat: 1 }));
    events.find(({ id }) => id === REHEARSAL_LONG_JUMP).competitors = [
      { id: 'demo-jumper', name: '示例选手', lane: 1, bib: '501', team: '1班', time: null, attempts: [519, 'X', 536], status: 'ok' },
    ];
  }
  return { version: 5, revision: 0, activeEventId: demo ? REHEARSAL_RACE : events[0].id, events, standby: defaultGraphics() };
}

function validGraphics(config, version) {
  return typeof config?.meet?.title === 'string' && typeof config.meet.subtitle === 'string' && /^#[0-9a-f]{6}$/i.test(config.meet.accent) &&
    typeof config.athlete?.name === 'string' && typeof config.notice?.body === 'string' && object(config.pages) &&
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

function validClock(clock) {
  return ['ready', 'running', 'paused', 'finished'].includes(clock?.phase) && Number.isFinite(clock.elapsed) &&
    (clock.startedAt === null || Number.isFinite(clock.startedAt));
}

export function verifyState(value) {
  requireThat(object(value) && [1, 2, 3, 4, 5].includes(value.version) && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    validGraphics(value.version >= 3 ? value.standby : value, value.version) && Array.isArray(value.events) &&
    value.events.length <= (value.version >= 4 ? MAX_EVENTS : 96), '设置文件格式不正确。');
  const ids = new Set();
  for (const event of value.events) {
    requireThat(typeof event?.id === 'string' && !ids.has(event.id) && typeof event.name === 'string' && typeof event.stage === 'string' &&
      Object.hasOwn(KINDS, event.kind) && Array.isArray(event.competitors) && Array.isArray(event.splits) &&
      validClock(event.clock) && object(event.score), '赛事设置记录损坏。');
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
      if (event.heatRuns !== undefined) {
        requireThat(Number.isInteger(event.heat) && event.heat >= 1 && event.heat <= MAX_HEATS && object(event.heatRuns) &&
          Object.entries(event.heatRuns).every(([heat, run]) => +heat !== event.heat && +heat >= 1 && +heat <= MAX_HEATS &&
            validClock(run?.clock) && Array.isArray(run.splits)), '分组计时记录损坏。');
      }
    }
    if (event.kind === 'match') {
      requireThat(['up', 'down'].includes(event.clockMode) && Number.isInteger(event.periodMinutes) &&
        ['home', 'away', 'period'].every((key) => Number.isInteger(event.score[key])), '球赛设置记录损坏。');
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
  const { meet, modules, athlete, notice, pages } = state;
  const current = { meet, modules, athlete, notice, pages };
  const template = { ...defaultGraphics(), meet: structuredClone(meet), modules: structuredClone(modules) };
  for (const key of ['lineup', 'results', 'athlete', 'notice']) template.modules[key].visible = false;
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
  return event.competitors.length > 0 || event.clock.phase !== 'ready' || event.clock.elapsed !== 0 || event.splits.length > 0 || Boolean(event.heatRuns);
}

export function migrateState(state) {
  if (state.version === 5) return state;
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
  let selectionId = activeEventId;
  for (const [oldId, schoolId] of REHEARSAL_TARGETS) {
    const sample = updated.find((event) => event.id === oldId && !event.schedule);
    const target = updated.find((event) => event.id === schoolId);
    if (!sample?.competitors.length || !sample.competitors.every(({ id }) => id.startsWith('demo-')) || !target || hasRaceData(target)) continue;
    if (['kind', 'division', 'distance', 'trackLength', 'legs'].some((key) => sample[key] !== target[key])) continue;
    const { competitors, clock, splits, rankOrder } = sample;
    updated = updated.filter(({ id }) => id !== oldId).map((event) => event.id === schoolId ?
      { ...event, competitors, clock, splits, ...(rankOrder ? { rankOrder } : {}) } : event);
    if (selectionId === oldId) selectionId = schoolId;
  }
  const selection = updated.find(({ id }) => id === selectionId) ?? updated.find((event) => event.schedule) ?? updated[0];
  const selected = selection?.id ?? null;
  return { version: 5, revision: state.revision + 1, events: updated, activeEventId: selected, standby: outputSettings };
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
    requireThat(distance / trackLength <= 50 && distance % legs === 0, '请填写可整除棒数的距离，最多支持 50 个通过点。');
    return { ...info, distance, trackLength, legs };
  }
  if (kind === 'match') {
    requireThat(['up', 'down'].includes(fields.clockMode), '请选择计时方向。');
    requireThat(['节', '半场', '局'].includes(fields.periodLabel), '请选择节次单位。');
    return { ...info, homeName: text(fields.homeName, 18, '主队', true), awayName: text(fields.awayName, 18, '客队', true),
      clockMode: fields.clockMode, periodMinutes: integer(fields.periodMinutes, 1, 180, '单节分钟数'), periodLabel: fields.periodLabel };
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
  if (info.kind === 'track' && ['distance', 'trackLength', 'legs'].some((key) => info[key] !== event[key])) {
    const runs = [{ clock: event.clock, splits: event.splits }, ...Object.values(event.heatRuns ?? {})];
    requireThat(runs.every(({ clock, splits }) => clock.phase === 'ready' && splits.length === 0), '请重置各组计时后修改距离或棒数。');
  }
  if (event.schedule) {
    requireThat(event.division === info.division, '本届赛程的组别固定，请选对应组别的赛事。');
    const start = fields.start ?? event.schedule.start;
    requireThat(validStart(start), '请输入有效的比赛时间。');
    event.schedule.start = start;
  }
  if (info.kind === 'match' && ['clockMode', 'periodMinutes'].some((key) => info[key] !== event[key])) {
    requireThat(event.clock.phase === 'ready' && event.clock.elapsed === 0, '请重置本节计时后修改方向或时长。');
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

function requireHeat(event, heat) {
  requireThat(heat === undefined || heat === (event.heat ?? 1), '当前分组已切换，请核对后再操作。');
}

function eventClock(state, { eventId, operation, value, heat }, now) {
  const event = getEvent(state, eventId);
  requireThat(event.kind === 'track' || event.kind === 'match', '本项目无需计时。');
  requireHeat(event, heat);
  const phase = clockPhase(event, now);
  const elapsed = elapsedTime(event.clock, now);
  const down = event.kind === 'match' && event.clockMode === 'down';
  const limit = down ? event.periodMinutes * 60000 : MAX_TIME;
  switch (operation) {
    case 'start':
    case 'resume':
      requireThat(phase === (operation === 'start' ? 'ready' : 'paused') && elapsed < limit, '计时状态已变化，请确认当前状态。');
      event.clock = { phase: 'running', elapsed, startedAt: now };
      break;
    case 'pause':
      requireThat(phase === 'running', '只有计时中可以暂停。');
      event.clock = { phase: 'paused', elapsed, startedAt: null };
      break;
    case 'finish':
      requireThat(['running', 'paused'].includes(phase), '请先开始计时。');
      event.clock = { phase: 'finished', elapsed, startedAt: null };
      break;
    case 'reset':
      event.clock = blankClock();
      event.splits = [];
      break;
    case 'set': {
      requireThat(phase !== 'running', '请暂停后校时。');
      const clock = parseTime(value ?? '');
      requireThat(clock <= limit, '校时值超出本项计时范围。');
      const adjusted = down ? limit - clock : clock;
      requireThat(adjusted >= (event.splits.at(-1)?.time ?? 0), '校时不能早于最近的通过记录。');
      event.clock = { phase: adjusted === limit ? 'finished' : (adjusted ? 'paused' : 'ready'), elapsed: adjusted, startedAt: null };
      break;
    }
    default: throw new Error('无法识别的计时操作。');
  }
}

function saveModule(state, { key, patch, eventId }) {
  requireThat(Object.hasOwn(MODULES, key) && object(patch), '包装模块不存在。');
  const { modules, pages, athlete, notice } = graphicsForActive(state, eventId);
  const layout = modules[key];
  if (Object.hasOwn(patch, 'visible')) {
    requireThat(typeof patch.visible === 'boolean', '请指定显隐状态。');
    const event = activeEvent(state);
    if (patch.visible) {
      requireThat(applicable(key, event), '当前赛事不适用这个模块。');
      if (key === 'athlete') requireThat(athlete.name, '请先填写人物信息。');
      if (key === 'notice') requireThat(notice.body, '请先填写公告。');
      if (TABLE_KEYS.includes(key)) {
        for (const other of TABLE_KEYS) if (other !== key) modules[other].visible = false;
        if (BOARD_KEYS.includes(key)) pages[key] = 0;
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
  'heat:select'(state, { eventId, heat }, now) {
    const event = getEvent(state, eventId);
    const current = event.heat ?? 1;
    const next = integer(heat, 1, MAX_HEATS, '分组');
    requireThat(event.kind === 'track' && event.schedule && heats(event).includes(next), '请先在名单设置分组。');
    if (current === next) return;
    requireThat(clockPhase(event, now) !== 'running', '请先暂停或结束本组计时。');
    const runs = event.heatRuns ??= {};
    runs[current] = { clock: event.clock, splits: event.splits };
    const saved = runs[next] ?? { clock: blankClock(), splits: [] };
    event.heat = next;
    event.clock = saved.clock;
    event.splits = saved.splits;
    delete runs[next];
    event.graphics.pages.lineup = 0;
  },
  'round:qualify'(state, { eventId }) {
    const event = getEvent(state, eventId);
    const final = finalFor(state.events, event);
    requireThat(final, '找不到对应的决赛。');
    requireThat(!final.competitors.length && final.clock.phase === 'ready', '决赛已有名单或计时，请在备赛名单中核对。');
    requireThat(event.clock.phase !== 'running', '请结束本组计时后确认晋级。');
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
      requireThat(event.clock.phase !== 'running', '请结束本组计时后确认计分。');
      requireThat(rows.length && new Set(rows.map(({ rank }) => rank)).size === rows.length, '请先按裁判结果确认有效名次和并列处理。');
      requireThat(rows.every(({ athlete }) => className(event, athlete)), '请给前八名填写单位或班级后再确认。');
      if (event.schedule.project === 'shuttle-50') requireThat(rows.every(({ athlete }) => relayRegistration(athlete) !== '人数不符'), '有队伍人数不符，请核验或按裁判结果取消资格。');
    }
    event.schedule.scored = scored;
  },
  'clock:action': eventClock,
  'split:add'(state, { eventId, index, heat }, now) {
    const event = getEvent(state, eventId);
    requireHeat(event, heat);
    const points = checkpoints(event);
    requireThat(event.kind === 'track' && clockPhase(event, now) === 'running', '请在径赛计时中记录通过。');
    requireThat(index === event.splits.length && index < points.length, '通过点已更新，请核对后继续。');
    event.splits.push({ distance: points[index], time: Math.floor(elapsedTime(event.clock, now) / 10) * 10 });
  },
  'split:undo'(state, { eventId, index, heat }) {
    const event = getEvent(state, eventId);
    requireHeat(event, heat);
    requireThat(event.splits.length > 0 && event.splits.length === index, '通过记录已更新，请重新确认。');
    event.splits.pop();
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
  'athlete:finish'(state, { eventId, id, heat }, now) {
    const event = getRosterEvent(state, eventId);
    const athlete = getAthlete(event, id);
    requireHeat(event, heat);
    requireThat(event.kind === 'track' && clockPhase(event, now) === 'running', '请在径赛计时中记录完赛。');
    requireThat((athlete.heat ?? 1) === (event.heat ?? 1), '该选手不在当前计时分组。');
    requireThat(athlete.status === 'pending', '该选手已录入成绩，可打开编辑修正。');
    athlete.time = Math.floor(elapsedTime(event.clock, now) / 10) * 10;
    athlete.status = 'ok';
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
  'athlete:import'(state, { eventId, rows, replace }) {
    const event = getRosterEvent(state, eventId);
    requireThat(Array.isArray(rows) && rows.length > 0 && rows.length <= MAX_COMPETITORS, `请导入 1 至 ${MAX_COMPETITORS} 位选手。`);
    const imported = rows.map((row, i) => {
      try { return readAthlete(row, event); }
      catch (error) { throw new Error(`CSV 第 ${Number.isInteger(row?.line) ? row.line : i + 2} 行：${error.message}`); }
    });
    const roster = replace === true ? imported : [...event.competitors, ...imported];
    ensureRoster(roster);
    event.competitors = roster;
    if (replace === true) delete event.rankOrder;
  },
  'rank:move': moveRank,
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
  'match:period'(state, { eventId, period }, now) {
    const event = getEvent(state, eventId);
    requireThat(event.kind === 'match' && clockPhase(event, now) !== 'running', '请先暂停本节计时。');
    const next = integer(period, 1, 30, '节次');
    if (next === event.score.period) return;
    event.score.period = next;
    event.clock = blankClock();
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
  'text:save'(state, { key, fields, visible, eventId }) {
    requireThat(object(fields) && ['athlete', 'notice'].includes(key), '文字内容无效。');
    const graphics = graphicsForActive(state, eventId);
    if (key === 'athlete') graphics.athlete = { name: text(fields.name, 30, '姓名或队名', true), detail: text(fields.detail, 42, '人物说明'), tag: text(fields.tag, 12, '人物标签') };
    else graphics.notice = { title: text(fields.title, 16, '公告标题', true), body: text(fields.body, 100, '公告内容', true) };
    if (visible === true) graphics.modules[key].visible = true;
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
