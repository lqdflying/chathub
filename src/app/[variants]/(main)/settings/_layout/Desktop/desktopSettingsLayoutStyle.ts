/**
 * Desktop Settings is a flex child of DesktopMainLayout. Default
 * `min-width: auto` is the min-content size, so a provider form / Codex card
 * can widen the whole Settings pane past the viewport (R11-1). Set 0 so the
 * item can shrink to the leftover width beside the app SideNav.
 *
 * @see https://www.w3.org/TR/css-flexbox-1/#min-size-auto
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/min-width
 * @see https://stackoverflow.com/questions/36247140/why-dont-flex-items-shrink-past-content-size
 */
export const DESKTOP_SETTINGS_LAYOUT_STYLE = {
  flex: '1',
  minWidth: 0,
  position: 'relative',
} as const;
