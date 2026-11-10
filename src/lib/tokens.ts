// Mirrors the :root colour tokens in styles.css for the 3D scenes.
const base = {
  "background": "#0A0F18",
  "panel": "#111A28",
  "surface": "#182436",
  "text": "#EEF4FF",
  "muted": "#9DB0CC",
  "border": "#5A77A0",
  "line": "#22324A",
  "primary": "#A2C7FF",
  "onPrimary": "#0A1A35",
  "action": "#245BA8",
  "onAction": "#FFFFFF",
  "warm": "#FF9A4D",
  "onWarm": "#2B1300",
  "focus": "#FFFFFF",
  "success": "#78D6A6",
  "warning": "#F6CF5F",
  "danger": "#FF8F86",
  "white": "#FFFFFF",
};

export const colors = {
  ...base,
  secondary: base.surface,
  secondaryInk: base.primary,
  onSecondary: base.text,
  tertiary: base.surface,
  tertiaryInk: base.primary,
  onTertiary: base.text,
};
