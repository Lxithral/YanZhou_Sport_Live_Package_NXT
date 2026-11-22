import { GRADES, PRESETS, resultValue, standings } from './sport.js';

export const FESTIVAL_NAME = '第五届「烟伙杯」校运会';
export const CHECK_IN_MINUTES = 25;
export const AWARD_LIMIT = 8;

// 只播出男子、女子 800 米四项。其余秩序册条目整段留在下面，恢复时去掉行首注释。
const fridayMorning = [
  // ['07:30', 'g1', 'women', 'run-100', 'heat'], ['07:45', 'g2', 'women', 'run-100', 'heat'],
  // ['08:05', 'g1', 'men', 'run-100', 'heat'], ['08:20', 'g2', 'men', 'run-100', 'heat'],
  // ['08:40', 'g1', 'women', 'run-400'], ['08:52', 'g2', 'women', 'run-400'],
  // ['09:21', 'g1', 'men', 'run-400'], ['09:41', 'g2', 'men', 'run-400'],
  // ['10:14', 'g1', 'women', 'run-100'], ['10:19', 'g2', 'women', 'run-100'],
  // ['10:29', 'g1', 'men', 'run-100'], ['10:34', 'g2', 'men', 'run-100'],
  // ['11:00', 'g1', 'women', 'run-200', 'heat'], ['11:10', 'g2', 'women', 'run-200', 'heat'],
  // ['11:27', 'g1', 'men', 'run-200', 'heat'], ['11:39', 'g2', 'men', 'run-200', 'heat'],
  // ['08:00', 'g1', 'women', 'long-jump'], ['08:00', 'g1', 'women', 'high-jump'],
  // ['08:00', 'g1', 'men', 'shot-put'], ['09:00', 'g2', 'women', 'shot-put'],
  // ['09:30', 'g2', 'women', 'high-jump'], ['10:00', 'g2', 'men', 'long-jump'],
];

const fridayAfternoon = [
  ['14:15', 'g1', 'women', 'run-800'], ['14:25', 'g2', 'women', 'run-800'],
  ['14:40', 'g1', 'men', 'run-800'], ['15:00', 'g2', 'men', 'run-800'],
  // ['15:40', 'g1', 'women', 'run-200'], ['15:45', 'g2', 'women', 'run-200'],
  // ['15:50', 'g1', 'men', 'run-200'], ['15:55', 'g2', 'men', 'run-200'],
  // ['14:15', 'g2', 'women', 'long-jump'], ['14:15', 'g1', 'men', 'high-jump'],
  // ['14:15', 'g1', 'women', 'shot-put'], ['15:15', 'g2', 'men', 'shot-put'],
  // ['15:45', 'g1', 'men', 'long-jump'], ['16:15', 'g2', 'men', 'high-jump'],
];

const saturdayMorning = [
  // ['07:30', 'g1', 'open', 'shuttle-50'], ['07:30', 'g2', 'open', 'shuttle-50'],
  // ['08:00', 'g1', 'women', 'relay-100'], ['08:15', 'g2', 'women', 'relay-100'],
  // ['08:30', 'g1', 'men', 'relay-100'], ['08:45', 'g2', 'men', 'relay-100'],
];

function race(day, [time, grade, division, project, round = 'final']) {
  return {
    ...PRESETS[project], id: `school-${grade}-${division}-${project}-${round}`, division,
    stage: round === 'heat' ? '预赛' : '决赛', venue: '烟洲中学田径场',
    schedule: { grade, project, round, start: time ? `2026-11-${day}T${time}` : '' },
  };
}

export const SCHOOL_RACES = [
  ...[...fridayMorning, ...fridayAfternoon].map((row) => race(27, row)),
  ...saturdayMorning.map((row) => race(28, row)),
  // 1000 米先不播，恢复时去掉行首注释。
  // ...['g1', 'g2'].flatMap((grade) => [race(null, ['', grade, 'men', 'run-1000']),
  //   race(null, ['', grade, 'men', 'run-1500']), race(null, ['', grade, 'women', 'run-1500']),
  // ]),
  // { ...PRESETS['staff-teams'], id: 'school-staff-teams', division: 'open', stage: '赛制待定', venue: '',
  //   schedule: { grade: 'staff', project: 'staff-teams', round: 'pending', start: '', session: '11/27 下午' } },
].sort(compareSchedule);

export const LIVE_PROJECTS = new Set(['run-800']);

export function onProgram(event) {
  if (!event) return false;
  if (event.schedule) return LIVE_PROJECTS.has(event.schedule.project);
  return event.kind === 'track' && event.distance === 800;
}

export function compareSchedule(first, second) {
  const time = ({ schedule }) => schedule?.start || (schedule?.session ? '2026-11-27T23:59' : '~');
  const left = time(first);
  const right = time(second);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function scheduleSession(schedule) {
  if (!schedule.start) return schedule.session || '时间待定';
  return `${schedule.start.slice(5, 10).replace('-', '/')} ${Number(schedule.start.slice(11, 13)) < 12 ? '上午' : '下午'}`;
}

export function checkInTime(start) {
  if (!start) return '';
  return new Date(Date.parse(`${start}Z`) - CHECK_IN_MINUTES * 60000).toISOString().slice(11, 16);
}

// Historic school records from page 13, in milliseconds or centimetres.
const RECORDS = {
  'run-100': [11100, 13900], 'run-200': [23810, 30160], 'run-400': [55960, 68000],
  'run-800': [130420, 167000], 'run-1000': [174000, null], 'run-1500': [277230, 360650],
  'relay-100': [48110, 60500], 'long-jump': [610, 455], 'high-jump': [168, 132], 'shot-put': [1179, 670],
};

export function schoolRecord(event) {
  return RECORDS[event.schedule?.project]?.[event.division === 'women' ? 1 : 0] ?? null;
}

export function beatsRecord(athlete, event) {
  const record = schoolRecord(event);
  const value = resultValue(athlete, event);
  return record !== null && value !== null && (event.kind === 'track' ? value < record : value > record);
}

export function finalFor(events, event) {
  const schedule = event?.schedule;
  if (schedule?.round !== 'heat') return;
  return events.find((candidate) => candidate.division === event.division && candidate.schedule?.grade === schedule.grade &&
    candidate.schedule.project === schedule.project && candidate.schedule.round === 'final');
}

export function canScore(event) {
  return event?.schedule?.round === 'final' && ['g1', 'g2'].includes(event.schedule.grade);
}

export function className(event, athlete) {
  const name = (athlete.team || (event.legs > 1 ? athlete.name : '')).trim();
  const number = name.replace(/\s/g, '').match(/^(?:高[一二]|\d{4}级)?[（(第]?0*([1-9]\d?)[）)]?班?$/u)?.[1];
  return number ? `${GRADES[event.schedule.grade]}${number}班` : name;
}

export function topRows(event, limit = AWARD_LIMIT) {
  return standings(event).filter(({ rank }) => rank !== null && rank <= limit);
}

const POINTS = [9, 7, 6, 5, 4, 3, 2, 1];

function comparePoints(first, second) {
  return second.total - first.total || second.records - first.records ||
    first.places.map((count, index) => second.places[index] - count).find(Boolean) || 0;
}

export function classStandings(events) {
  const entries = events.filter((event) => canScore(event) && event.schedule.scored).flatMap((event) =>
    topRows(event).map((row) => ({ ...row, event, team: className(event, row.athlete) })));
  const best = new Map();
  const recordKey = (event) => `${event.schedule.project}:${event.division}`;
  for (const { athlete, event, value } of entries) {
    if (!beatsRecord(athlete, event)) continue;
    const key = recordKey(event);
    const previous = best.get(key);
    if (previous === undefined || (event.kind === 'track' ? value < previous : value > previous)) best.set(key, value);
  }

  const grades = { g1: new Map(), g2: new Map() };
  for (const { team, rank, event, value } of entries) {
    if (!team) continue;
    const teams = grades[event.schedule.grade];
    if (!teams.has(team)) teams.set(team, { team, total: 0, records: 0, places: Array(AWARD_LIMIT).fill(0) });
    const tally = teams.get(team);
    const record = best.get(recordKey(event)) === value;
    const points = POINTS[rank - 1] * (event.legs > 1 ? 2 : 1);
    tally.total += points * (record ? 2 : 1);
    tally.records += Number(record);
    tally.places[rank - 1]++;
  }
  return Object.fromEntries(Object.entries(grades).map(([grade, classes]) => {
    const rows = [...classes.values()].sort((a, b) => comparePoints(a, b) || a.team.localeCompare(b.team, 'zh-CN', { numeric: true }));
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      row.rank = previous && comparePoints(previous, row) === 0 ? previous.rank : index + 1;
      row.tied = row.rank !== index + 1 || Boolean(rows[index + 1] && comparePoints(row, rows[index + 1]) === 0);
    });
    return [grade, rows];
  }));
}
