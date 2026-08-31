/**
 * Map ChatHub provider ids to `@lobehub/icons` ProviderIcon keys, and optional
 * local logo URLs when the pinned icons package does not ship the brand yet.
 *
 * XiaomiMiMo landed in `@lobehub/icons` v3+ as `xiaomimimo`. ChatHub still pins
 * 2.x (`^2.42.0` → 2.48.0), so `mimo` uses vendored assets under
 * `public/icons/providers/` until the package is upgraded.
 */

const PROVIDER_ICON_MAP: Record<string, string> = {
  anthropiccompatible: 'anthropic',
  openaicompatible: 'openai',
};

export type ProviderLogoVariant = 'avatar' | 'mono';

type LocalProviderLogo = {
  avatar: string;
  mono: string;
};

const PROVIDER_LOCAL_LOGOS: Record<string, LocalProviderLogo> = {
  mimo: {
    avatar: '/icons/providers/mimo-avatar.webp',
    mono: '/icons/providers/mimo.svg',
  },
};

export const resolveProviderIcon = (id: string): string => PROVIDER_ICON_MAP[id] || id;

export const resolveProviderLogoUrl = (
  id: string,
  variant: ProviderLogoVariant = 'avatar',
): string | undefined => {
  const entry = PROVIDER_LOCAL_LOGOS[id];
  if (!entry) return undefined;
  return variant === 'mono' ? entry.mono : entry.avatar;
};

/** Model ids that should use the Xiaomi MiMo local mark (ModelIcon has no mimo keywords on icons 2.x). */
export const resolveModelLogoUrl = (modelId: string): string | undefined => {
  const id = modelId.toLowerCase();
  if (id.startsWith('mimo') || id.includes('xiaomimimo')) {
    return PROVIDER_LOCAL_LOGOS.mimo.mono;
  }
  return undefined;
};
