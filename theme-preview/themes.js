(() => {
  const key = 'damage-calculator-preview-theme';
  const themes = [
    { id: 'original', name: '預設', group: 'basic' },
    { id: 'seasonal', name: '共存節', group: 'basic' },
    { id: 'harbor', name: '薄霧', group: 'palette' },
    { id: 'forest', name: '森林', group: 'palette' },
    { id: 'ember', name: '夕陽', group: 'palette' },
  ];
  const valid = value => themes.some(theme => theme.id === value);
  let applied = 'seasonal';
  try { applied = sessionStorage.getItem(key) || applied; } catch {}
  const requested = new URL(location.href).searchParams.get('preview-theme');
  if (valid(requested)) applied = requested;
  if (!valid(applied)) applied = 'seasonal';
  const seasonal = document.querySelector('link[data-theme-seasonal]');
  const header = document.querySelector('.site-header');
  if (!header) return;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'theme-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'theme-popover');
  trigger.innerHTML = '<span>主題</span><i class="theme-trigger-swatch" aria-hidden="true"></i>';
  header.classList.add('theme-header-ready');
  header.append(trigger);

  const popover = document.createElement('div');
  popover.id = 'theme-popover';
  popover.className = 'theme-popover';
  popover.setAttribute('popover', 'auto');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-labelledby', 'theme-popover-title');
  popover.innerHTML = `
    <div class="theme-popover-top"><div><h2 id="theme-popover-title">選擇主題</h2><p class="theme-applied-label"></p></div><button class="theme-popover-close" type="button" aria-label="關閉主題選擇"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="theme-popover-scroll">
      <section class="theme-group" aria-labelledby="theme-basic-heading"><h3 id="theme-basic-heading">基本</h3><div class="theme-card-grid theme-card-grid-basic"></div></section>
      <section class="theme-group" aria-labelledby="theme-palette-heading"><h3 id="theme-palette-heading">配色</h3><div class="theme-card-grid theme-card-grid-palette"></div></section>
    </div>`;
  for (const theme of themes) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-card theme-card-${theme.id}`;
    card.dataset.theme = theme.id;
    card.innerHTML = `<span class="theme-card-art" aria-hidden="true"></span><span class="theme-card-name">${theme.name}</span><span class="theme-card-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>`;
    popover.querySelector(`.theme-card-grid-${theme.group}`).append(card);
  }
  document.body.append(popover);

  const cards = [...popover.querySelectorAll('.theme-card')];
  const updateSelection = () => {
    for (const card of cards) {
      const active = card.dataset.theme === applied;
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-pressed', String(active));
      card.setAttribute('aria-label', `${themes.find(theme => theme.id === card.dataset.theme).name}${active ? '，目前使用中' : ''}`);
    }
    popover.querySelector('.theme-applied-label').textContent = `目前使用：${themes.find(theme => theme.id === applied).name}`;
  };
  const applyTheme = value => {
    if (seasonal) seasonal.media = value === 'seasonal' ? 'all' : 'not all';
    if (value === 'original' || value === 'seasonal') delete document.documentElement.dataset.previewTheme;
    else document.documentElement.dataset.previewTheme = value;
    applied = value;
    trigger.dataset.theme = value;
    trigger.setAttribute('aria-label', `主題：${themes.find(theme => theme.id === value).name}，開啟主題選擇`);
    try { sessionStorage.setItem(key, value); } catch {}
    updateSelection();
  };
  applyTheme(applied);

  const position = () => {
    if (!popover.matches(':popover-open')) return;
    const anchor = trigger.getBoundingClientRect();
    const gap = 8;
    const edge = 12;
    const width = popover.offsetWidth;
    const left = Math.max(edge, Math.min(anchor.right - width, innerWidth - width - edge));
    const below = innerHeight - anchor.bottom - gap - edge;
    const above = anchor.top - gap - edge;
    const useAbove = below < 300 && above > below;
    const available = useAbove ? above : below;
    popover.style.left = `${left}px`;
    popover.style.top = `${useAbove ? Math.max(edge, anchor.top - gap - Math.min(popover.scrollHeight, available)) : anchor.bottom + gap}px`;
    popover.style.maxHeight = `${Math.max(0, available)}px`;
  };
  const close = (returnFocus = false) => {
    if (popover.matches(':popover-open')) popover.hidePopover();
    if (returnFocus) trigger.focus();
  };
  let pointerWasOpen = false;
  trigger.addEventListener('pointerdown', () => {
    pointerWasOpen = popover.matches(':popover-open');
  });
  trigger.addEventListener('pointercancel', () => { pointerWasOpen = false; });
  trigger.addEventListener('keydown', () => { pointerWasOpen = false; });
  trigger.addEventListener('click', () => {
    if (pointerWasOpen || popover.matches(':popover-open')) { pointerWasOpen = false; close(true); return; }
    popover.showPopover();
    position();
    popover.querySelector('.theme-popover-close').focus();
  });
  popover.querySelector('.theme-popover-close').addEventListener('click', () => close(true));
  popover.addEventListener('click', event => {
    const card = event.target.closest('.theme-card');
    if (card) applyTheme(card.dataset.theme);
  });
  popover.addEventListener('toggle', event => {
    trigger.setAttribute('aria-expanded', String(event.newState === 'open'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popover.matches(':popover-open')) {
      event.preventDefault();
      close(true);
    }
  });
  addEventListener('resize', position);
  addEventListener('scroll', position, true);
})();
