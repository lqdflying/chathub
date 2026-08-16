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

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Embeds the trusted, app-generated design-system stylesheet into a sanitized
 * SVG so the downloaded file renders like the inline preview without the app's
 * CSS.
 *
 * The exported artifact is served as `image/svg+xml` (XML), but
 * `sanitizeSVGContent` returns HTML serialization — which can contain named
 * entities XML does not define (e.g. `&nbsp;` from ordinary diagram text) and
 * would make the download unparseable. So the whole document is normalized to
 * XML: the sanitized body is parsed as HTML (decoding those entities), the
 * stylesheet is added as a `<style>` node via `textContent`, and the SVG root
 * is re-serialized with `XMLSerializer`. That also escapes any `&`/`<`/`>` in
 * the rules (notably the operator-set `CUSTOM_FONT_FAMILY` flowing through
 * `token.fontFamily`), so no manual escaping is needed. Browser/jsdom only —
 * the sole caller is the download handler. Only `rules` produced by
 * {@link buildDiagramRules} should be passed — never content-derived CSS.
 */
export const buildStandaloneSVG = (sanitizedSVG: string, rules: string): string => {
  const parsed = new DOMParser().parseFromString(sanitizedSVG, 'text/html');
  const svg = parsed.querySelector('svg');
  if (!svg) return sanitizedSVG;

  const style = parsed.createElementNS(SVG_NAMESPACE, 'style');
  style.textContent = rules;
  const defs = parsed.createElementNS(SVG_NAMESPACE, 'defs');
  defs.append(style);
  svg.prepend(defs);

  return new XMLSerializer().serializeToString(svg);
};
