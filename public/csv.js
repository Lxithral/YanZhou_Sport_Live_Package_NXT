import { GRADES, formatMark, formatTime, resultText, standings } from './sport.js';

const headers = ['道次', '号码', '姓名', '单位', '成绩', '状态', '试次', '名次'];
const names = {
  lane: ['道次', '道', 'lane'], bib: ['号码', '编号', 'bib'], name: ['姓名', '选手', '队名', 'name'],
  team: ['单位', '班级', 'team'], result: ['成绩', 'result', 'time'], status: ['状态', 'status'], attempts: ['试次', 'attempts'],
  heat: ['分组', '组次', 'heat'], boys: ['男生人数', 'boys'], girls: ['女生人数', 'girls'], jumps: ['跳高记录', 'jumps'],
};

function splitCsv(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let closed = false;
  const endCell = () => { row.push(cell); cell = ''; closed = false; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = false; closed = true; }
      continue;
    }
    if (c === delimiter) endCell();
    else if (c === '\n' || c === '\r') {
      endRow();
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (closed) throw new Error(`CSV 第 ${rows.length + 1} 行的引号后应接逗号或换行。`);
    else if (c === '"') {
      if (cell) throw new Error(`CSV 第 ${rows.length + 1} 行的引号应位于单元格开头。`);
      quoted = true;
    } else cell += c;
  }
  if (quoted) throw new Error(`CSV 第 ${rows.length + 1} 行有未闭合的引号。`);
  if (row.length || cell || closed) endRow();
  return rows;
}

export function readCsv(text) {
  const rows = splitCsv(text.replace(/^\uFEFF/, ''));
  const first = rows.findIndex((row) => row.some((cell) => cell.trim()));
  const columns = (rows[first] ?? []).map((name) => name.trim().toLowerCase());
  const fields = Object.entries(names).map(([key, aliases]) => [key, columns.findIndex((column) => aliases.includes(column))]);
  if (fields.find(([key]) => key === 'name')[1] < 0) throw new Error('CSV 表头需要「姓名」或 name 列。');
  return rows.slice(first + 1).map((cells, i) => {
    if (!cells.some((cell) => cell.trim())) return null;
    if (cells.length > columns.length && cells.slice(columns.length).some((cell) => cell.trim())) {
      throw new Error(`CSV 第 ${i + first + 2} 行超出表头的列数。`);
    }
    return {
      line: i + first + 2,
      ...Object.fromEntries(fields.map(([key, index]) => [key, (cells[index] ?? '').trim().replace(/^'(?=[=+\-@])/, '')])),
    };
  }).filter(Boolean);
}

function csvCell(raw) {
  const value = String(raw ?? '');
  const escaped = /^[\s]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${escaped.replaceAll('"', '""')}"`;
}

function csv(rows) {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function extraColumns(event) {
  const project = event.schedule?.project;
  return [
    ...(event.kind === 'track' && event.schedule ? [['分组', 'heat', 1]] : []),
    ...(project === 'shuttle-50' ? [['男生人数', 'boys', 5], ['女生人数', 'girls', 5]] : []),
    ...(project === 'high-jump' ? [['跳高记录', 'jumps', '']] : []),
  ];
}

export function csvTemplate(event) {
  const extra = extraColumns(event);
  const example = event.schedule?.project === 'shuttle-50' ? ['1', '101', '1班代表队', '1班', '', '', '', ''] :
    ['1', '101', '示例选手', '1班', '', '', '', ''];
  return csv([[...headers, ...extra.map(([label]) => label)], [...example, ...extra.map(([, , value]) => value)]]);
}

export function csvResults(event) {
  if (event.kind === 'match') return csv([
    ['项目', '组别', '节次', '主队', '主队得分', '客队', '客队得分'],
    [event.name, event.stage, event.score.period, event.homeName, event.score.home, event.awayName, event.score.away],
  ]);
  const extra = extraColumns(event);
  const rows = standings(event).map(({ athlete, rank, value }) => [
    athlete.lane, athlete.bib, athlete.name, athlete.team,
    value === null ? (athlete.status === 'pending' ? '' : resultText(athlete, event)) :
      (event.kind === 'field' ? formatMark(value).replace(' m', '') : formatTime(value)),
    athlete.status,
    athlete.attempts.map((attempt) => Number.isInteger(attempt) ? formatMark(attempt).replace(' m', '') : attempt).join('|'), rank,
    ...extra.map(([, key]) => key === 'jumps' ? (athlete.jumps ?? []).map(({ height, outcome }) => `${height}:${outcome}`).join('|') : athlete[key]),
  ]);
  return csv([[...headers, ...extra.map(([label]) => label)], ...rows]);
}

export function csvClassPoints(grade, rows) {
  return csv([['年级', '名次', '班级', '总分', '破纪录数', '依据'],
    ...rows.map(({ rank, team, total, records, tied }) => [GRADES[grade], rank, team, total, records, tied ? '待裁判抽签' : ''])]);
}
