// A subset of cockpit's design kit (https://github.com/quaresc/cockpit — MIT, see THIRD_PARTY_NOTICES.md), copied 2026-11-20:
// shadcn/ui proportions drawn with GPUI elements, colored from Herdr's theme(). Changed here: Icon's path, Mono's font.
// Rhythm: a 4px grid, 13px body, 12px secondary, 11px captions; radius 6 (controls), 4 (kbd); color only for state.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, settings } from "herdr";

export const RADIUS = { sm: 4, md: 6, lg: 8, xl: 12 };
export const TEXT = { xs: 11, sm: 12, base: 13, lg: 15, xl: 18 };

/** The kit's color tokens, shadcn's names on Herdr's theme. */
export function tokens() {
  const t = theme();
  return {
    t,
    background: t.background,
    foreground: t.foreground,
    card: t.background,
    canvas: t.canvas ?? t.background,
    chrome: t.chrome ?? t.surface,
    popover: t.popover ?? t.surface,
    muted: t.raised ?? t.hover,
    mutedFg: t.muted,
    dim: t.dim,
    accent: t.hover,
    selected: t.selected ?? t.hover,
    border: t.border,
    input: t.input ?? t.border,
    ring: t.accent,
    primary: t.solid ?? t.foreground,
    primaryFg: t.solid_foreground ?? t.background,
    destructive: t.ansi1,
    success: t.ansi2 ?? t.done,
    warning: t.ansi3 ?? t.working,
    info: t.accent,
    working: t.working,
    blocked: t.blocked,
    done: t.done,
    idle: t.idle,
  };
}

/** A lucide icon from icons/, tinted with `color` (else the text color). */
export function Icon(name, { size = 16, color } = {}) {
  const el = svg(`mods/forge/icons/${name}.svg`).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

/** A turning ring: loading. */
export function Spinner({ size = 14, color } = {}) {
  return Icon("loader", { size, color }).spin(900);
}

const MODIFIER = { ctrl: "⌃", cmd: "⌘", alt: "⌥", opt: "⌥", shift: "⇧" };

/** A key as the Mac writes it: "ctrl p", "ctrl-p" and "ctrl+p" read "⌃P", "cmd-shift-p" "⌘⇧P"; the rest as given. */
export function keyLabel(key) {
  const s = String(key);
  if (!/^(ctrl|cmd|alt|opt|shift)[ +-]./i.test(s)) return s;
  const parts = s.split(/[ +-](?=.)/);
  const last = parts.pop();
  return parts.map((p) => MODIFIER[p.toLowerCase()] ?? p).join("") + (last.length === 1 ? last.toUpperCase() : last);
}

/** Keys as shadcn's <Kbd>: "⌘K", ["⌘", "K"], or "ctrl-p" (written ⌃P). */
export function Kbd(keys) {
  const k = tokens();
  const list = (Array.isArray(keys) ? keys : [keys]).map(keyLabel);
  return h_flex()
    .gap(2)
    .flex_none()
    .children(
      list.map((key) =>
        h_flex()
          .h(20)
          .min_w(20)
          .px(5)
          .items_center()
          .justify_center()
          .rounded(RADIUS.sm)
          .border_1()
          .border_color(k.border)
          .bg(k.muted)
          .text_size(TEXT.xs)
          .font_medium()
          .text_color(k.mutedFg)
          .child(String(key)),
      ),
    );
}

const BUTTON = {
  default: (k) => ({ bg: k.primary, fg: k.primaryFg, hover: (s) => s.opacity(0.9) }),
  secondary: (k) => ({ bg: k.muted, fg: k.foreground, hover: (s) => s.bg(k.selected) }),
  outline: (k) => ({ bg: k.background, fg: k.foreground, border: k.input, hover: (s) => s.bg(k.accent) }),
  ghost: (k) => ({ fg: k.foreground, hover: (s) => s.bg(k.accent) }),
  // The background's color on the red reads in both themes: dark themes' red is light, white on it washes out.
  destructive: (k) => ({ bg: k.destructive, fg: k.background, hover: (s) => s.opacity(0.9) }),
  link: (k) => ({ fg: k.foreground, hover: (s) => s.underline() }),
};
const SIZE = { default: [32, 12, TEXT.base, 16], sm: [28, 10, TEXT.sm, 14], lg: [36, 16, TEXT.base, 16], icon: [32, 0, TEXT.base, 16], "icon-sm": [28, 0, TEXT.sm, 14] };

/**
 * A button: variant default | secondary | outline | ghost | destructive | link, size default | sm | lg | icon |
 * icon-sm; `kbd` shows its key; `tooltip` on hover. `onClick(event, cx)`.
 */
export function Button(id, { label, icon, iconRight, variant = "default", size = "default", kbd, disabled = false, tooltip, onClick, grow = false } = {}) {
  const k = tokens();
  const v = (BUTTON[variant] ?? BUTTON.default)(k);
  const [h, px, text, iconSize] = SIZE[size] ?? SIZE.default;
  const square = size === "icon" || size === "icon-sm";
  let el = h_flex()
    .id(id)
    .h(h)
    .gap(6)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(RADIUS.md)
    .text_size(text)
    .font_medium()
    .text_color(v.fg)
    .whitespace_nowrap();
  el = square ? el.w(h) : el.px(px);
  if (grow) el = el.flex_1();
  if (v.bg) el = el.bg(v.bg);
  if (v.border) el = el.border_1().border_color(v.border);
  if (icon) el = el.child(Icon(icon, { size: iconSize }));
  if (label && !square) el = el.child(label);
  if (iconRight) el = el.child(Icon(iconRight, { size: iconSize }));
  if (kbd && !square) el = el.child(Kbd(kbd));
  if (disabled) return el.opacity(0.5);
  el = el.cursor_pointer().hover(v.hover);
  if (onClick) el = el.on_click((e, cx) => onClick(e, cx));
  if (tooltip) el = el.tooltip(tooltip);
  return el;
}

/** A pulsing placeholder while data loads. */
export function Skeleton({ w, h = 16, radius = RADIUS.md } = {}) {
  const k = tokens();
  let el = div().h(h).rounded(radius).bg(k.muted).loop("opacity", { from: 0.45, to: 1, period: 1400 });
  return w ? el.w(w) : el.w_full();
}

/** A section label above a group: small, medium weight, muted; a count and an action at the right. */
export function SectionHeader(text, { count, action, id } = {}) {
  const k = tokens();
  let el = h_flex().h(28).px(8).gap(6).items_center().text_size(TEXT.sm).font_medium().text_color(k.mutedFg).child(text);
  if (count !== undefined) el = el.child(div().text_color(k.dim).child(String(count)));
  if (action) el = el.child(div().flex_1()).child(action);
  return id ? el.id(id) : el;
}

/** A footer line of key hints: [["⏎", "edit"], ["x", "done"], ...]. */
export function KeyHints(hints) {
  const k = tokens();
  return h_flex()
    .h(36)
    .px(24)
    .gap(14)
    .flex_none()
    .items_center()
    .border_t_1()
    .border_color(k.border)
    .text_size(TEXT.xs)
    .text_color(k.mutedFg)
    .children(hints.map(([key, what]) => h_flex().gap(6).items_center().child(Kbd(key)).child(what)));
}

/** Text in the mono face, for what you would type: branches, keys, numbers. */
export function Mono(text, { size = TEXT.xs, color } = {}) {
  const k = tokens();
  return div().flex_none().font_family(settings().font_family).text_size(size).text_color(color ?? k.mutedFg).child(String(text ?? ""));
}
