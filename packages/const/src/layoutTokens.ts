import type { ActionIconProps, FormProps } from '@lobehub/ui';

export const HEADER_HEIGHT = 64;
export const MOBILE_NABBAR_HEIGHT = 44;
export const MOBILE_TABBAR_HEIGHT = 48;
export const MOBILE_TABBAR_SAFE_HEIGHT = `calc(${MOBILE_TABBAR_HEIGHT}px + env(safe-area-inset-bottom, 0))`;
export const CHAT_TEXTAREA_MAX_HEIGHT = 800;
export const CHAT_TEXTAREA_HEIGHT = 160;
export const CHAT_TEXTAREA_HEIGHT_MOBILE = 108;
export const CHAT_SIDEBAR_WIDTH = 280;
export const CONVERSATION_MIN_WIDTH = 850;
export const SHELL_BORDER_RADIUS = 10;
export const CHAT_HEADER_HEIGHT = 42;
export const CHAT_PANEL_GAP = 8;
export const CHAT_PANEL_RADIUS = 8;
export const TOUCH_TARGET_SIZE = 32;

export const CHAT_PORTAL_WIDTH = 400;
export const CHAT_PORTAL_MAX_WIDTH = 1280;
export const CHAT_PORTAL_TOOL_UI_WIDTH = 600;

export const MARKET_SIDEBAR_WIDTH = 400;
export const FOLDER_WIDTH = 270;
export const MAX_WIDTH = 1024;
export const FORM_STYLE: FormProps = {
  itemMinWidth: 'max(34%, 240px)',
  style: { maxWidth: MAX_WIDTH, width: '100%' },
};
export const MOBILE_HEADER_ICON_SIZE: ActionIconProps['size'] = { blockSize: 40, size: 22 };
export const DESKTOP_HEADER_ICON_SIZE: ActionIconProps['size'] = { blockSize: TOUCH_TARGET_SIZE, size: 19 };
export const HEADER_ICON_SIZE = (mobile?: boolean) =>
  mobile ? MOBILE_HEADER_ICON_SIZE : DESKTOP_HEADER_ICON_SIZE;
export const PWA_INSTALL_ID = 'pwa-install';
