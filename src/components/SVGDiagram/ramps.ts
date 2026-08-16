export type RampName =
  'amber' | 'blue' | 'coral' | 'gray' | 'green' | 'pink' | 'purple' | 'red' | 'teal';

export interface DiagramRamp {
  /** darkest stop — dark-mode fill / light-mode text */
  dark: string;
  /** lightest stop — light-mode fill / dark-mode text */
  light: string;
  /** mid stop — stroke in both modes */
  mid: string;
}

/**
 * Categorical color ramps for AI-drawn SVG diagrams (`c-<name>` classes).
 * Each ramp maps to fill/stroke/text roles that invert between light and
 * dark mode; the values are fixed anchors, not theme tokens, so diagrams
 * keep the same hue identity in both modes.
 */
export const DIAGRAM_RAMPS: Record<RampName, DiagramRamp> = {
  amber: { dark: '#412402', light: '#FAEEDA', mid: '#BA7517' },
  blue: { dark: '#042C53', light: '#E6F1FB', mid: '#378ADD' },
  coral: { dark: '#4A1B0C', light: '#FAECE7', mid: '#D85A30' },
  gray: { dark: '#2C2C2A', light: '#F1EFE8', mid: '#888780' },
  green: { dark: '#173404', light: '#EAF3DE', mid: '#639922' },
  pink: { dark: '#4B1528', light: '#FBEAF0', mid: '#D4537E' },
  purple: { dark: '#26215C', light: '#EEEDFE', mid: '#7F77DD' },
  red: { dark: '#501313', light: '#FCEBEB', mid: '#E24B4A' },
  teal: { dark: '#04342C', light: '#E1F5EE', mid: '#1D9E75' },
};
