import { escapeHtml as h } from './client.js';
import { icon } from './control-views.js';
import { DIVISIONS, PRESETS, eventTitle } from './sport.js';

export class Dialogs {
  constructor(command) {
    this.command = command;
    this.dialog = document.querySelector('#editor');
    this.form = document.querySelector('#editor-form');
    this.title = document.querySelector('#editor-title');
    this.content = document.querySelector('#editor-content');
    this.error = document.querySelector('#editor-error');
    this.actions = document.querySelector('#editor-actions');
    this.job = null;
    this.resolve = null;
    document.querySelector('#close-editor').innerHTML = icon('close');
    document.querySelector('#close-editor').addEventListener('click', () => this.close(false));
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const primary = this.actions.querySelector('.primary') ?? this.actions.querySelector('[data-value]');
      this.submit(primary?.dataset.value ?? 'ok');
    });
    this.actions.addEventListener('click', (event) => {
      const target = event.target.closest('[data-value]');
      if (target) this.submit(target.dataset.value);
    });
    this.dialog.addEventListener('close', () => {
      const resolve = this.resolve;
      this.resolve = null;
      this.job = null;
      resolve?.(false);
    });
  }

  feedback(message) {
    this.error.textContent = message;
    this.error.hidden = !message;
  }

  close(value) {
    if (value === false) {
      this.resolve = null;
      this.job = null;
      this.dialog.close();
      return;
    }
  }

  submit(value) {
    const job = this.job;
    if (!job) return;
    this.feedback('');
    Promise.resolve()
      .then(() => job(value))
      .then((result) => {
        if (result === false) return;
        this.resolve = null;
        this.job = null;
        this.dialog.close();
      })
      .catch((error) => this.feedback(error.message));
  }

  show(title, content, actions, job = async () => true) {
    if (this.dialog.open) this.dialog.close();
    this.title.textContent = title;
    this.content.innerHTML = content;
    this.actions.innerHTML = actions.map(({ label, value, variant = '' }) => `<button type="button" class="button ${variant}" data-value="${value}">${h(label)}</button>`).join('');
    this.feedback('');
    this.job = job;
    this.dialog.showModal();
    this.content.querySelector('input:not([type=file]), select, textarea')?.focus();
    return new Promise((resolve) => {
      this.resolve = (result) => resolve(result ?? false);
      this.dialog.addEventListener('close', () => this.resolve?.(false), { once: true });
      const original = this.resolve;
      this.resolve = (result) => resolve(result ?? false);
    });
  }

  confirm(title, body, label, job, variant = 'danger') {
    return this.show(title, `<p class="confirm-text">${h(body)}</p>`, [
      { label: '取消', value: 'cancel', variant: 'subtle' },
      { label, value: 'ok', variant },
    ], async (value) => {
      if (value !== 'ok') return true;
      await job();
      return true;
    }).then((result) => result === 'ok' || result === true);
  }

  event(event, division) {
    const editing = Boolean(event);
    const presets = Object.entries(PRESETS).filter(([key, preset]) => preset.kind === 'track' && ['run-800', 'run-1000'].includes(key));
    const current = event?.schedule?.project ?? 'run-800';
    const stage = event?.stage ?? '决赛';
    const content = `<div class="field-grid">
      ${editing ? '' : `<label class="field field-wide"><span>项目</span><select name="preset">${presets.map(([key, preset]) => `<option value="${key}" ${key === current ? 'selected' : ''}>${h(preset.name)}</option>`).join('')}</select></label>`}
      <label class="field field-wide"><span>项目名称</span><input name="name" maxlength="28" value="${h(event?.name ?? '800米')}" required></label>
      ${editing ? '' : `<label class="field"><span>组别</span><select name="division" ${event?.schedule ? 'disabled' : ''}>${Object.entries(DIVISIONS).map(([key, label]) => `<option value="${key}" ${(division ?? event?.division) === key ? 'selected' : ''}>${h(label)}</option>`).join('')}</select></label>`}
      <label class="field"><span>组次 / 轮次</span><input name="stage" maxlength="24" value="${h(stage)}"></label>
      <label class="field field-wide"><span>赛场</span><input name="venue" maxlength="38" value="${h(event?.venue ?? '烟洲中学田径场')}"></label>
      ${event?.schedule ? `<label class="field field-wide"><span>预计开赛</span><input name="start" type="datetime-local" value="${h(event.schedule.start.slice(0, 16))}"></label>` : ''}
    </div>
    <p class="form-note">${editing ? '本届校运会的组别与轮次跟随赛程表，可调整名称、赛场与开赛时间。' : '新赛事会立即成为当前赛事；正式赛程请从校运会赛程里选择。'}</p>`;
    const actions = [
      ...(editing && !event.schedule ? [{ label: '删除赛事', value: 'delete', variant: 'danger subtle' }] : []),
      { label: '取消', value: 'cancel', variant: 'subtle' },
      { label: editing ? '保存' : '创建赛事', value: 'save', variant: 'primary' },
    ];
    return this.show(editing ? `编辑赛事 · ${eventTitle(event)}` : '新建赛事', content, actions, async (value) => {
      if (value === 'cancel') return true;
      if (value === 'delete') {
        await this.command('event:delete', { eventId: event.id });
        return true;
      }
      const data = new FormData(this.form);
      const presetKey = editing ? event.schedule?.project : data.get('preset');
      const preset = PRESETS[presetKey] ?? PRESETS['run-800'];
      const fields = {
        kind: 'track',
        name: String(data.get('name') ?? '').trim() || preset.name,
        division: editing ? event.division : (data.get('division') ?? preset.division ?? 'men'),
        stage: String(data.get('stage') ?? ''),
        venue: String(data.get('venue') ?? ''),
      };
      if (!editing) {
        fields.distance = preset.distance;
        fields.trackLength = preset.trackLength ?? 400;
        fields.legs = preset.legs ?? 1;
      }
      if (event?.schedule) fields.start = String(data.get('start') ?? '').replace('T', ' ');
      await this.command('event:save', { id: event?.id, fields });
      return true;
    });
  }

  meet(state, overlayUrl) {
    const fields = state.meet;
    const content = `<div class="field-grid">
      <label class="field field-wide"><span>OBS 浏览器地址</span><input value="${h(overlayUrl)}" readonly aria-label="OBS 浏览器地址"></label>
      <label class="field field-wide"><span>页脚文字</span><input name="title" maxlength="20" value="${h(fields.title ?? '')}" placeholder="如 第五届烟伙杯校运会"></label>
      <label class="field field-wide"><span>挂角副标题</span><input name="subtitle" maxlength="24" value="${h(fields.subtitle ?? '')}" placeholder="如 田径场 · 决赛"></label>
      <label class="field"><span>强调色</span><input name="accent" type="color" value="${h(fields.accent ?? '#f5c84b')}"></label>
    </div>
    <p class="form-note">把地址填入 OBS「浏览器」源，分辨率 1920×1080，勾选「关闭源时关闭源」。刷新页面即可恢复。</p>`;
    return this.show('直播信息', content, [
      { label: '取消', value: 'cancel', variant: 'subtle' },
      { label: '保存', value: 'save', variant: 'primary' },
    ], async (value) => {
      if (value === 'cancel') return true;
      const data = new FormData(this.form);
      await this.command('meet:save', {
        title: String(data.get('title') ?? ''),
        subtitle: String(data.get('subtitle') ?? ''),
        accent: String(data.get('accent') ?? ''),
      });
      return true;
    });
  }
}
