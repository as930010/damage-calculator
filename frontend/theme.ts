export type ThemeMode = "dark" | "light";

interface ThemeButton {
  addEventListener(type: "click", listener: () => void): void;
  setAttribute(name: string, value: string): void;
  textContent: string | null;
  title: string;
}

interface ThemeRoot {
  dataset: DOMStringMap;
}

const preferenceKey = "damage-calculator-theme";

export function initializeThemeToggle(button: ThemeButton, root: ThemeRoot, storage?: Storage): void {
  let activeTheme: ThemeMode = "dark";
  try {
    const saved = (storage ?? localStorage).getItem(preferenceKey);
    if (saved === "light") activeTheme = "light";
  } catch { /* Theme preference is optional. */ }

  const apply = (theme: ThemeMode, persist: boolean) => {
    activeTheme = theme;
    root.dataset.theme = theme;
    button.textContent = theme === "light" ? "暗色模式" : "明亮模式";
    button.title = theme === "light" ? "切換至暗色模式" : "切換至明亮模式";
    button.setAttribute("aria-pressed", String(theme === "light"));
    if (persist) {
      try { (storage ?? localStorage).setItem(preferenceKey, theme); } catch { /* Theme preference is optional. */ }
    }
  };

  apply(activeTheme, false);
  button.addEventListener("click", () => apply(activeTheme === "light" ? "dark" : "light", true));
}
