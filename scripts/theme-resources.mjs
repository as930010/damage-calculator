// Keep the visual layer inactive in HTML, including when all scripts fail.
export const seasonalStylesheetLink = href => `<link rel="stylesheet" href="${href}" media="not all" data-theme-seasonal />`;

// Attribute order and unrelated link attributes do not affect recognition.
export const seasonalStylesheetPattern = /<link\b(?=[^>]*\srel=["']stylesheet["'])(?=[^>]*\shref=["']([^"']*seasonal-effects-[^"'/]+\.css)["'])[^>]*>/g;

export function createThemePreferences(hasSeasonal) {
  const key = 'damage-calculator-preview-theme';
  const valid = value => ['original', 'harbor', 'forest', 'ember'].includes(value) || (value === 'seasonal' && hasSeasonal);
  const requested = new URL(location.href).searchParams.get('preview-theme');
  const read = name => { try { return window[name].getItem(key); } catch { return null; } };
  const resolve = () => [requested, read('localStorage'), read('sessionStorage')].find(valid) ?? 'original';
  const save = value => {
    try {
      if (window.localStorage.getItem(key) !== value) window.localStorage.setItem(key, value);
      return 'local';
    } catch {}
    try { window.sessionStorage.setItem(key, value); return 'session'; } catch {}
    return 'page';
  };
  return { key, valid, requested, resolve, save };
}

export const themeController = source => source.replace('__THEME_PREFERENCES__', '(' + createThemePreferences.toString() + ')');

// Runs in the head before the first paint. Only explicit preferences activate a theme.
export const themeBootstrap = `<!-- theme-bootstrap:start --><script>
try {
  const seasonal = document.querySelector('link[data-theme-seasonal]');
  const preferences = (${createThemePreferences.toString()})(Boolean(seasonal));
  const selected = preferences.resolve();
  preferences.save(selected);
  const palettes = ['harbor', 'forest', 'ember'];
  if (selected === 'seasonal') {
    // An initially non-matching sheet must participate in the first render when selected.
    seasonal.setAttribute('blocking', 'render');
    seasonal.media = 'all';
  } else if (palettes.includes(selected)) document.documentElement.dataset.previewTheme = selected;
} catch {}
</script><!-- theme-bootstrap:end -->`;
