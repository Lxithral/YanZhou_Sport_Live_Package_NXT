import { escapeHtml as h } from './client.js';
import { icon } from './control-views.js';

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
}
