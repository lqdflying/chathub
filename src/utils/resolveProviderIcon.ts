/**
 * Map ChatHub provider ids to `@lobehub/icons` ProviderIcon keys, and local
 * avatar URLs so Settings tiles match Xiaomi MiMo (full-bleed webp, not the
 * package `IconAvatar` glyph-on-badge).
 *
 * XiaomiMiMo landed in `@lobehub/icons` v3+ as `xiaomimimo`. ChatHub still pins
 * 2.x (`^2.42.0` → 2.48.0), so `mimo` also vendors a mono SVG. Other builtins
 * keep package mono/color marks; only avatar tiles are local.
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
  mono?: string;
};

const VENDORED_PROVIDER_AVATAR_IDS = [
  'anthropic',
  'azure',
  'azureai',
  'deepseek',
  'google',
  'mimo',
  'minimax',
  'moonshot',
  'openai',
  'xai',
  'zhipu',
] as const;

const providerAvatarUrl = (id: string): string => `/icons/providers/${id}-avatar.webp`;

const PROVIDER_LOCAL_LOGOS: Record<string, LocalProviderLogo> = Object.fromEntries(
  VENDORED_PROVIDER_AVATAR_IDS.map((id) => [
    id,
    {
      avatar: providerAvatarUrl(id),
      ...(id === 'mimo' || id === 'xai' ? { mono: `/icons/providers/${id}.svg` } : {}),
    },
  ]),
);

export const resolveProviderIcon = (id: string): string => PROVIDER_ICON_MAP[id] || id;

/** True when ChatHub should render the inline Xiaomi MiMo mono mark. */
export const hasLocalProviderMono = (id: string): boolean => id === 'mimo' || id === 'xai';

const lookupLocalProviderLogo = (id: string): LocalProviderLogo | undefined =>
  PROVIDER_LOCAL_LOGOS[id] ?? PROVIDER_LOCAL_LOGOS[resolveProviderIcon(id)];

export const resolveProviderLogoUrl = (
  id: string,
  variant: ProviderLogoVariant = 'avatar',
): string | undefined => {
  const entry = lookupLocalProviderLogo(id);
  if (!entry) return undefined;
  // Never hand the mono SVG URL to Avatar/img — callers use XiaomiMiMoMono instead.
  if (variant === 'mono') return undefined;
  return entry.avatar;
};

export const isMimoModelId = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return id.startsWith('mimo') || id.includes('xiaomimimo');
};

export const isXaiModelId = (modelId: string): boolean => {
  const id = modelId.toLowerCase();
  return id.startsWith('grok-') || id.includes('grok.');
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
  if (isMimoModelId(modelId)) return resolveProviderLogoUrl('mimo', variant);
  if (isXaiModelId(modelId)) return resolveProviderLogoUrl('xai', variant);
  return undefined;
};
