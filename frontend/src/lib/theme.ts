// Light/dark theme. Dark (Warm Ink) is the brand default. Persisted in localStorage,
// applied as data-theme on <html> so the CSS variables in index.css switch.
export type Theme = "light" | "dark";
const KEY = "crossed.theme.v1";

export function getTheme(): Theme {
  try {
    const s = localStorage.getItem(KEY);
    if (s === "light" || s === "dark") return s;
  } catch { /* no storage */ }
  return "dark";
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
}

export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  applyTheme(t);
}

export function initTheme(): void {
  applyTheme(getTheme());
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}
