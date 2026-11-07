const base = {
  "focus": "#8B204B",
  "success": "#166148",
  "warning": "#725900",
  "danger": "#AD233F",
  "white": "#FFFFFF",
  "background": "#F3F7FF",
  "surface": "#D6E7FF",
  "panel": "#FFFFFF",
  "text": "#132344",
  "muted": "#405576",
  "border": "#627BA4",
  "primary": "#A2C7FF",
  "onPrimary": "#132344",
  "action": "#245BA8",
  "onAction": "#FFFFFF"
};

export const colors = {
  ...base,
  secondary: base.primary,
  secondaryInk: base.action,
  onSecondary: base.text,
  tertiary: base.surface,
  tertiaryInk: base.action,
  onTertiary: base.text,
};
