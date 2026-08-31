/**
 * Map ChatHub provider ids to `@lobehub/icons` ProviderIcon keys, and optional
 * local logo URLs when the pinned icons package does not ship the brand yet.
 *
 * XiaomiMiMo landed in `@lobehub/icons` v3+ as `xiaomimimo`. ChatHub still pins
 * 2.x (`^2.42.0` → 2.48.0), so `mimo` uses vendored assets under
 * `public/icons/providers/` until the package is upgraded.
 *
 * Mono marks must be rendered as an inline SVG (`XiaomiMiMoMono`), not via the
 * public `.svg` URL through Avatar/`<img>` — `currentColor` does not inherit
 * across that boundary and disappears in dark mode.
 */

const PROVIDER_ICON_MAP: Record<string, string> = {
  anthropiccompatible: 'anthropic',
  openaicompatible: 'openai',
};

export type ProviderLogoVariant = 'avatar' | 'mono';

type LocalProviderLogo = {
  avatar: string;
  /** Public SVG path kept for reference/CDN; UI must use XiaomiMiMoMono for mono. */
  mono: string;
};

const PROVIDER_LOCAL_LOGOS: Record<string, LocalProviderLogo> = {
  mimo: {
    avatar: '/icons/providers/mimo-avatar.webp',
    mono: '/icons/providers/mimo.svg',
  },
};

export const resolveProviderIcon = (id: string): string => PROVIDER_ICON_MAP[id] || id;

/** True when ChatHub should render the inline Xiaomi MiMo mono mark. */
export const hasLocalProviderMono = (id: string): boolean => id === 'mimo';

export const resolveProviderLogoUrl = (
  id: string,
  variant: ProviderLogoVariant = 'avatar',
): string | undefined => {
  const entry = PROVIDER_LOCAL_LOGOS[id];
  if (!entry) return undefined;
  // Never hand the mono SVG URL to Avatar/img — callers use XiaomiMiMoMono instead.
  if (variant === 'mono') return undefined;
  return entry.avatar;
};

export const isMimoModelId = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return id.startsWith('mimo') || id.includes('xiaomimimo');
};

/**
 * Model ids that should use the Xiaomi MiMo local mark (ModelIcon has no mimo
 * keywords on icons 2.x). Default/avatar → webp; mono → undefined (use
 * XiaomiMiMoMono inline).
 */
export const resolveModelLogoUrl = (
  modelId: string,
  variant: ProviderLogoVariant = 'avatar',
): string | undefined => {
  if (!isMimoModelId(modelId)) return undefined;
  return resolveProviderLogoUrl('mimo', variant);
};
