import { escapeHtml as h } from './client.js';
import { button, input, select } from './control-views.js';
import { csvTemplate, readCsv } from './csv.js';
import { DIVISIONS, GRADES, PRESETS, activeEvent, canJump, clockValue, eventRound, eventTitle, formatTime, inferDivision, jumpFailures, jumpHeight } from './sport.js';

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename.replace(/[<>:"/\\|?*]/g, ' ')}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function submitButton(label, value = '', variant = 'primary') {
  return `<button class="button ${variant}" type="submit" value="${value}">${label}</button>`;
}

export class Dialogs {
  constructor(command) {
    this.command = command;
    this.dialog = document.querySelector('#editor');
    this.form = document.querySelector('#editor-form');
    this.content = document.querySelector('#editor-content');
    this.title = document.querySelector('#editor-title');
    this.error = document.querySelector('#editor-error');
    this.actions = document.querySelector('#editor-actions');
    document.querySelector('#close-editor').addEventListener('click', () => this.dialog.close());
    this.actions.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="dialog-cancel"]')) this.dialog.close();
    });
    this.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      this.feedback('');
      const job = this.job;
      if (this.pending === job) return;
      const submitter = event.submitter;
      this.pending = job;
      if (submitter) submitter.disabled = true;
      try {
        const close = await job(formValues(this.form), submitter?.value);
        if (this.job === job && close !== false) this.dialog.close();
      } catch (error) {
        if (this.job === job) this.feedback(error.message);
      } finally {
        if (submitter) submitter.disabled = false;
        if (this.pending === job) this.pending = null;
      }
    });
  }

  feedback(message) {
    this.error.hidden = !message;
    this.error.textContent = message;
  }

  show(title, content, actions, job) {
    this.job = job;
    this.title.textContent = title;
    this.content.innerHTML = content;
    this.actions.innerHTML = button('取消', { action: 'dialog-cancel' }) + actions;
    this.feedback('');
    if (!this.dialog.open) this.dialog.showModal();
    this.dialog.querySelector('[autofocus], #editor-content input, #editor-content select, [data-action="dialog-cancel"]')?.focus();
  }

  confirm(title, body, label, job, variant = 'primary') {
    this.show(title, `<p class="confirm-text">${h(body)}</p>`, submitButton(label, '', variant), job);
  }

  event(event, division = 'men') {
    const presets = { ...PRESETS,
      'custom-track': { ...PRESETS['run-1000'], name: '' }, 'custom-field': { ...PRESETS['long-jump'], name: '' },
      'custom-match': { ...PRESETS.football, name: '' },
    };
    const labels = Object.fromEntries(Object.entries(presets).map(([id, row]) => [id, row.name || ({ track: '自定义径赛', field: '自定义田赛', match: '自定义球赛' })[row.kind]]));
    const existing = Boolean(event);
    const currentDivision = event ? event.division ?? inferDivision(event.stage, event.name) : division;
    let draft = event ? { ...event, division: currentDivision, stage: currentDivision === 'open' ? event.stage : eventRound(event.stage) }
      : { ...PRESETS['run-1000'], division, stage: '决赛', venue: '' };
    this.show(existing ? '编辑赛事' : '新建赛事',
      `${existing ? '' : select('项目预设', 'preset', labels, 'run-1000')}<div id="event-fields"></div>`,
      existing ? button('删除赛事', { action: 'dialog-delete', glyph: 'trash', variant: 'danger subtle' }) + submitButton('保存赛事') :
        submitButton('创建待播赛事', 'prepare') + submitButton('创建并切换', 'live', ''),
      (values, mode) => this.command('event:save', { id: event?.id, activate: mode === 'live', fields: { ...values, kind: draft.kind } }));
    const fields = this.content.querySelector('#event-fields');
    function draw() {
      const track = draft.kind === 'track';
      const match = draft.kind === 'match';
      fields.innerHTML = `${input('项目名称', 'name', draft.name, 'maxlength="28" required')}
        <div class="field-pair">${draft.schedule ? input('比赛组别', 'group', `${GRADES[draft.schedule.grade]} · ${DIVISIONS[draft.division]}`, 'readonly') : select('比赛组别', 'division', DIVISIONS, draft.division)}${input('组次 / 轮次', 'stage', draft.stage, 'maxlength="24" placeholder="如 第 2 组、决赛"')}</div>
        ${draft.schedule ? input('预计开赛时间', 'start', draft.schedule.start, 'type="datetime-local"') : ''}
        ${input('赛场', 'venue', draft.venue, 'maxlength="38" placeholder="如 田径场"')}
        ${track ? `<div class="field-triple">${input('总距离（米）', 'distance', draft.distance, 'type="number" min="10" max="30000" required')}
          ${input('每圈（米）', 'trackLength', draft.trackLength, 'type="number" min="50" max="1000" required')}
          ${input('棒数', 'legs', draft.legs, 'type="number" min="1" max="12" required')}</div>` : ''}
        ${match ? `<div class="field-pair">${input('主队', 'homeName', draft.homeName, 'maxlength="18" required')}${input('客队', 'awayName', draft.awayName, 'maxlength="18" required')}</div>
          <div class="field-triple">${select('计时方向', 'clockMode', { down: '倒计时', up: '正计时' }, draft.clockMode)}
          ${input('单节（分钟）', 'periodMinutes', draft.periodMinutes, 'type="number" min="1" max="180" required')}
          ${select('节次单位', 'periodLabel', { 节: '节', 半场: '半场', 局: '局' }, draft.periodLabel)}</div>` : ''}`;
    }
    draw();
    this.content.querySelector('[name="preset"]')?.addEventListener('change', (e) => {
      const { division, stage, venue } = formValues(this.form);
      draft = { ...presets[e.target.value], division, stage, venue };
      draw();
    });
    if (existing) {
      fields.querySelector('[name="name"]').focus();
      this.actions.querySelector('[data-action="dialog-delete"]').addEventListener('click', () => this.confirm(
        '删除赛事？', `将删除「${eventTitle(event)}」的名单、计时、成绩和画面设置。`, '删除赛事',
        () => this.command('event:delete', { eventId: event.id }), 'danger'));
    }
  }

  athlete(event, athlete) {
    const edit = Boolean(athlete);
    const field = event.kind === 'field';
    const row = athlete ?? {};
    const highJump = event.schedule?.project === 'high-jump';
    const shuttle = event.schedule?.project === 'shuttle-50';
    const flags = { pending: '按录入成绩计算', DNS: 'DNS · 未出发', DNF: 'DNF · 未完成', DQ: 'DQ · 取消资格' };
    this.show(edit ? '编辑选手' : '添加选手',
      `<div class="field-pair">${input('姓名 / 队名', 'name', row.name, 'maxlength="30" required')}${input('单位 / 班级', 'team', row.team, 'maxlength="35"')}</div>
      <div class="field-pair">${input(field ? '出场序' : '道次', 'lane', row.lane, 'type="number" min="1" max="999"')}${input('号码', 'bib', row.bib, 'maxlength="14"')}</div>
      ${event.kind === 'track' && event.schedule ? input('计时分组', 'heat', row.heat ?? 1, 'type="number" min="1" max="32"') : ''}
      ${shuttle ? `<div class="field-pair">${input('男生人数', 'boys', row.boys, 'type="number" min="0" max="99"')}${input('女生人数', 'girls', row.girls, 'type="number" min="0" max="99"')}</div><p class="form-note">每班 10 名队员，男、女各 5 名。</p>` : ''}
      ${field ? input('试次（米）', 'attempts', row.attempts?.map((value) => typeof value === 'number' ? (value / 100).toFixed(2) : value).join('|'), 'maxlength="128" placeholder="5.22|X|5.31"') :
        event.kind === 'track' ? input('成绩', 'result', Number.isFinite(row.time) ? formatTime(row.time) : '', 'maxlength="24" placeholder="03:21.52 或 12.35"') : ''}
      ${highJump ? input('跳高记录（厘米）', 'jumps', row.jumps?.map(({ height, outcome }) => `${height}:${outcome}`).join('|'), 'maxlength="1400" placeholder="95:O|100:X|100:O"') : field ? '<p class="form-note">用 | 隔开试次，X 表示犯规，- 表示放弃本次。</p>' : ''}
      ${select('成绩状态', 'status', flags, Object.hasOwn(flags, row.status) ? row.status : 'pending')}`,
      `${edit ? button('删除选手', { action: 'dialog-delete', glyph: 'trash', variant: 'danger subtle' }) : ''}${submitButton(edit ? '保存选手' : '添加选手')}`,
      (fields) => this.command('athlete:save', { eventId: event.id, id: row.id, fields }));
    if (edit) this.actions.querySelector('[data-action="dialog-delete"]').addEventListener('click', () => this.confirm(
      '删除选手？', `将从当前赛事删除「${athlete.name}」及该选手的成绩。`, '删除选手',
      () => this.command('athlete:delete', { eventId: event.id, id: athlete.id }), 'danger'));
  }

  attempt(event, athlete) {
    if (event.schedule?.project === 'high-jump') {
      const height = jumpHeight(event);
      const jumps = athlete.jumps ?? [];
      const available = canJump(event, athlete);
      const undone = jumps.length && ['pending', 'ok', 'NM'].includes(athlete.status);
      const history = jumps.map(({ height: bar, outcome }) => `${bar}${outcome}`).join(' / ');
      this.show(`${athlete.name} · ${height} cm`, `<p class="form-note">${h(history || '本场还没有试跳记录。')}</p>
        ${!available ? `<p class="form-note">${jumpFailures(athlete) >= 3 ? '连续三次失败，试跳结束。' : '当前高度无需继续试跳。'}</p>` : ''}`,
        `${undone ? submitButton('撤销上次', 'undo', '') : ''}${available ? submitButton('免跳', '-', '') + submitButton('失败', 'X', '') + submitButton('过杆', 'O') : ''}`,
        (_, outcome) => outcome === 'undo'
          ? this.command('jump:undo', { eventId: event.id, id: athlete.id, index: jumps.length })
          : this.command('jump:mark', { eventId: event.id, id: athlete.id, index: jumps.length, height, outcome }));
      return;
    }
    this.show(`记录第 ${athlete.attempts.length + 1} 次 · ${athlete.name}`,
      `${select('试次结果', 'kind', { mark: '有效', X: '犯规', '-': '放弃本次' }, 'mark')}
      ${input('成绩（米）', 'mark', '', 'inputmode="decimal" maxlength="8" required autofocus placeholder="5.32"')}`, submitButton('记录试次'),
      ({ kind, mark }) => this.command('athlete:attempt', { eventId: event.id, id: athlete.id, index: athlete.attempts.length, value: kind === 'mark' ? mark : kind }));
    this.content.querySelector('[name="kind"]').addEventListener('change', (e) => {
      const mark = this.content.querySelector('[name="mark"]');
      mark.disabled = e.target.value !== 'mark';
      mark.closest('label').hidden = mark.disabled;
      if (!mark.disabled) mark.focus();
    });
  }

  csv(event) {
    const extra = event.schedule?.project === 'shuttle-50' ? '迎面接力可填写男生人数、女生人数。' :
      event.schedule && event.kind === 'track' ? '多组径赛请填写「分组」列，留空默认第 1 组。' : '';
    this.show(`导入名单 · ${eventTitle(event)}`,
      `<p class="form-note">选择 CSV 文件或从 Excel 复制表格粘贴。表头需要「姓名」或「队名」。${extra}</p>
      <label class="field"><span>选择 CSV 文件</span><input type="file" accept=".csv,text/csv" name="file"></label>
      <label class="field"><span>CSV 内容</span><textarea name="csv" rows="6" maxlength="150000" required placeholder="道次,号码,姓名,单位"></textarea></label>
      ${select('导入方式', 'mode', { add: '追加到当前名单', replace: '替换当前名单与成绩' }, 'add')}
      <p class="form-note" id="csv-preview"></p>`,
      button('下载模板', { action: 'csv-template', glyph: 'download' }) + submitButton('确认导入'),
      async ({ csv, mode }) => {
        const rows = readCsv(csv);
        if (mode === 'replace' && event.competitors.length) {
          this.confirm('替换当前名单？', `用这 ${rows.length} 位选手替换「${eventTitle(event)}」的名单和成绩。`, '替换并导入',
            () => this.command('athlete:import', { eventId: event.id, rows, replace: true }), 'danger');
          return false;
        }
        await this.command('athlete:import', { eventId: event.id, rows, replace: mode === 'replace' });
      });
    const field = this.content.querySelector('[name="csv"]');
    const preview = this.content.querySelector('#csv-preview');
    const refresh = () => {
      try { preview.textContent = field.value.trim() ? `已读取 ${readCsv(field.value).length} 行选手资料。` : ''; }
      catch (error) { preview.textContent = error.message; }
    };
    field.addEventListener('input', refresh);
    this.content.querySelector('[name="file"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        if (file.size > 150000) throw new Error('请将 CSV 压缩到 150 KB 以内。');
        const buffer = await file.arrayBuffer();
        try { field.value = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { field.value = new TextDecoder('gb18030').decode(buffer); }
        refresh();
      } catch (error) { this.feedback(error.message); }
    });
    this.actions.querySelector('[data-action="csv-template"]').addEventListener('click', () => downloadCsv(`${event.name}-名单模板`, csvTemplate(event)));
  }

  meet(state, overlayUrl) {
    const event = activeEvent(state);
    this.show('直播信息',
      `<p class="form-note">${event ? h(eventTitle(event)) + ' · ' : ''}OBS 浏览器来源 · 1920 × 1080</p>
      ${input('输出地址', 'output', overlayUrl, 'readonly')}
      ${input('榜单页脚', 'title', state.meet.title, 'maxlength="20" required')}
      ${input('挂角副标题', 'subtitle', state.meet.subtitle, 'maxlength="24"')}
      ${input('画面强调色', 'accent', state.meet.accent, 'type="color" required')}`, submitButton('保存直播信息'),
      ({ title, subtitle, accent }) => this.command('meet:save', { eventId: state.activeEventId, title, subtitle, accent }));
    const address = this.content.querySelector('[name="output"]');
    address.addEventListener('click', () => address.select());
  }

  text(state, key, athlete, publish = false) {
    const notice = key === 'notice';
    const person = athlete ? { name: athlete.name, detail: [athlete.team, athlete.bib && `号码 ${athlete.bib}`].filter(Boolean).join(' · ').slice(0, 42), tag: '参赛选手' } : state.athlete;
    const fields = notice
      ? `${input('公告标题', 'title', state.notice.title, 'maxlength="16" required')}${input('公告内容', 'body', state.notice.body, 'maxlength="100" required')}`
      : `${input('姓名 / 队名', 'name', person.name, 'maxlength="30" required')}${input('人物说明', 'detail', person.detail, 'maxlength="42"')}${input('标签', 'tag', person.tag, 'maxlength="12"')}`;
    this.show(notice ? '编辑公告' : '编辑人物条', fields,
      `${submitButton('保存', '', publish ? '' : 'primary')}${submitButton('保存并上屏', 'publish', publish ? 'primary' : '')}`,
      (fields, value) => this.command('text:save', { eventId: state.activeEventId, key, fields, visible: value === 'publish' }));
  }

  setClock(event, now) {
    this.show('校时', input(event.clockMode === 'down' ? '剩余时间' : '已用时间', 'value', formatTime(clockValue(event, now)), 'maxlength="14" required'),
      submitButton('应用校时'), ({ value }) => this.command('clock:action', { eventId: event.id, heat: event.heat ?? 1, operation: 'set', value }));
  }

  passes(event) {
    const items = event.splits.map(({ distance, time }) => `<li><span>${distance} m</span><b>${formatTime(time)}</b></li>`).join('');
    this.show('通过记录', `<ol class="pass-history">${items}</ol>`, '', () => {});
  }
}
