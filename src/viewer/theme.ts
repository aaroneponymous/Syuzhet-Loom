// Colours passed to React Flow as values (edge strokes, SVG arrowheads, the dot grid). They point at the CSS
// tokens in styles.css, so the light and dark themes apply to them too.
export const EDGE = {
  normal: 'var(--edge)',
  signal: 'var(--edge-signal)',
  open: 'var(--edge-open)',
  selected: 'var(--edge-selected)',
};
export const CANVAS_DOTS = 'var(--dots)';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'syuzhet-loom-theme';

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Applies a choice to <html>: 'system' removes the attribute so the CSS follows prefers-color-scheme. */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* storage unavailable: the choice still applies for this visit */
  }
}
