import { DIAGRAM_CLASS_PREFIX } from '@lobechat/utils/client';

import { DIAGRAM_RAMPS } from './ramps';

export interface DiagramRuleTokens {
  colorBorder: string;
  colorBorderSecondary: string;
  colorFillQuaternary: string;
  colorText: string;
  colorTextSecondary: string;
  colorTextTertiary: string;
  fontFamily: string;
}

// Selectors target the namespaced class vocabulary the sanitizer emits
// (`svgd-*`), so they only ever match diagram nodes, never app markup.
const P = DIAGRAM_CLASS_PREFIX;

/**
 * Single source of the diagram design-system CSS rules, shared by the in-app
 * stylesheet (scoped under the SVGDiagram canvas class) and the standalone
 * stylesheet embedded into exported .svg files.
 *
 * Typography and ink rules are scoped to the explicit prompt classes
 * (`t`/`ts`/`th`) — never to bare `text` — so legacy SVGs that style through
 * presentation attributes (font-size/font-family/fill) render as authored.
 */
export const buildDiagramRules = (token: DiagramRuleTokens, isDarkMode: boolean): string => {
  const ramps = Object.entries(DIAGRAM_RAMPS)
    .map(
      ([name, { light, mid, dark }]) => `
        .${P}c-${name} rect,
        .${P}c-${name} circle,
        .${P}c-${name} ellipse,
        .${P}c-${name} polygon {
          fill: ${isDarkMode ? dark : light};
          stroke: ${mid};
        }

        .${P}c-${name} text {
          fill: ${isDarkMode ? light : dark};
        }

        .${P}c-${name} line {
          stroke: ${mid};
        }
      `,
    )
    .join('\n');

  return `
    text.${P}t,
    text.${P}ts,
    text.${P}th {
      font-family: ${token.fontFamily};
      fill: ${token.colorText};
    }

    text.${P}t,
    text.${P}th {
      font-size: 14px;
    }

    text.${P}ts {
      font-size: 12px;
      fill: ${token.colorTextSecondary};
    }

    text.${P}th {
      font-weight: 500;
    }

    .${P}box {
      fill: ${token.colorFillQuaternary};
      stroke: ${token.colorBorderSecondary};
    }

    .${P}arr {
      stroke: ${token.colorTextTertiary};
      stroke-width: 1.5;
      fill: none;
    }

    .${P}leader {
      stroke: ${token.colorBorder};
      stroke-width: 1;
      stroke-dasharray: 4 3;
      fill: none;
    }

    ${ramps}
  `;
};

// Escape XML text characters so a value interpolated into the rules (notably
// the operator-configured CUSTOM_FONT_FAMILY, which flows into token.fontFamily)
// cannot break out of the <style> element or invalidate the exported XML.
const escapeXml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Embeds the trusted, app-generated design-system stylesheet into a sanitized
 * SVG so the downloaded file renders like the inline preview without the app's
 * CSS. The stylesheet is XML-escaped: the exported artifact is serialized as
 * `image/svg+xml`, so raw concatenation of a value containing `&` or `<` would
 * produce invalid or active markup. Only `rules` produced by
 * {@link buildDiagramRules} may be passed — never content-derived CSS.
 */
export const buildStandaloneSVG = (sanitizedSVG: string, rules: string): string => {
  const openingTag = sanitizedSVG.match(/<svg\b[^>]*>/i);
  if (!openingTag || openingTag.index === undefined) return sanitizedSVG;

  const insertAt = openingTag.index + openingTag[0].length;
  return `${sanitizedSVG.slice(0, insertAt)}<defs><style>${escapeXml(rules)}</style></defs>${sanitizedSVG.slice(insertAt)}`;
};
