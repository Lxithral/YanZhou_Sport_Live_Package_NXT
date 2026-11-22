// 深浅色主题：跟随系统 / 浅色 / 深色，选择存在 localStorage。
// 在 <head> 里同步执行，避免首屏闪一下错误的配色。
(() => {
  const key = 'yanzhou-theme';
  const options = ['auto', 'light', 'dark'];
  const system = matchMedia('(prefers-color-scheme: light)');

  function preference() {
    const saved = localStorage.getItem(key);
    return options.includes(saved) ? saved : 'auto';
  }

  function apply() {
    const choice = preference();
    const theme = choice === 'auto' ? (system.matches ? 'light' : 'dark') : choice;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    for (const button of document.querySelectorAll('[data-theme-option]')) {
      const selected = button.dataset.themeOption === choice;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  apply();
  system.addEventListener('change', apply);
  addEventListener('storage', (event) => {
    if (event.key === key || event.key === null) apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    for (const button of document.querySelectorAll('[data-theme-option]')) {
      button.addEventListener('click', () => {
        const next = button.dataset.themeOption;
        if (next === 'auto') localStorage.removeItem(key);
        else localStorage.setItem(key, next);
        apply();
      });
    }
    apply();
  });
})();
