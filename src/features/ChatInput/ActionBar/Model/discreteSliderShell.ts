import type { CSSProperties } from 'react';

/** Compact centered rail for 3–4 step Ant Design sliders (OpenAI gear, etc.). */
export const mergeDiscreteSliderShell = (extra: CSSProperties): CSSProperties => ({
  boxSizing: 'border-box',
  marginInline: 'auto',
  maxWidth: 248,
  minWidth: 0,
  width: '100%',
  ...extra,
});
