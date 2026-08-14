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
        .c-${name} rect,
        .c-${name} circle,
        .c-${name} ellipse,
        .c-${name} polygon {
          fill: ${isDarkMode ? dark : light};
          stroke: ${mid};
        }

        .c-${name} text {
          fill: ${isDarkMode ? light : dark};
        }

        .c-${name} line {
          stroke: ${mid};
        }
      `,
    )
    .join('\n');

  return `
    text.t,
    text.ts,
    text.th {
      font-family: ${token.fontFamily};
      fill: ${token.colorText};
    }

    text.t,
    text.th {
      font-size: 14px;
    }

    text.ts {
      font-size: 12px;
      fill: ${token.colorTextSecondary};
    }

    text.th {
      font-weight: 500;
    }

    .box {
      fill: ${token.colorFillQuaternary};
      stroke: ${token.colorBorderSecondary};
    }

    .arr {
      stroke: ${token.colorTextTertiary};
      stroke-width: 1.5;
      fill: none;
    }

    .leader {
      stroke: ${token.colorBorder};
      stroke-width: 1;
      stroke-dasharray: 4 3;
      fill: none;
    }

    ${ramps}
  `;
};

/**
 * Embeds the trusted, app-generated design-system stylesheet into a sanitized
 * SVG so the downloaded file renders like the inline preview without the app's
 * CSS. Only `rules` produced by {@link buildDiagramRules} may be passed —
 * never content-derived CSS.
 */
export const buildStandaloneSVG = (sanitizedSVG: string, rules: string): string => {
  const openingTag = sanitizedSVG.match(/<svg\b[^>]*>/i);
  if (!openingTag || openingTag.index === undefined) return sanitizedSVG;

  const insertAt = openingTag.index + openingTag[0].length;
  return `${sanitizedSVG.slice(0, insertAt)}<defs><style>${rules}</style></defs>${sanitizedSVG.slice(insertAt)}`;
};
