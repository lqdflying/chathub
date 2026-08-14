import { createStyles } from 'antd-style';

import { DIAGRAM_RAMPS } from './ramps';

/**
 * Theme-side half of the diagram design system: gives real values to the
 * class vocabulary the model is prompted to use (`t/ts/th/box/node/arr/leader`
 * and `c-<ramp>`). Must stay in sync with the SVG guidelines in
 * `src/tools/artifacts/systemRole.ts`.
 */
export const useStyles = createStyles(({ css, token, isDarkMode }) => {
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

  return {
    actionsInline: css`
      position: absolute;
      inset-block-start: 8px;
      inset-inline-end: 8px;

      opacity: 0;

      transition: opacity 0.2s ${token.motionEaseInOut};
    `,
    actionsPortal: css`
      position: absolute;
      inset-block-end: 8px;
      inset-inline-end: 8px;
    `,
    canvas: css`
      width: 100%;

      svg {
        display: block;

        width: 100%;
        height: auto;
        max-width: 680px;
        margin-inline: auto;
      }

      text {
        user-select: text;

        font-family: ${token.fontFamily};
        font-size: 14px;

        fill: ${token.colorText};
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

      .node {
        cursor: default;
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
    `,
    canvasPortal: css`
      display: flex;
      align-items: center;
      justify-content: center;

      height: 100%;

      svg {
        width: 100%;
        height: 100%;
        max-width: none;
      }
    `,
    root: css`
      position: relative;
      width: 100%;

      &:hover .svg-diagram-actions,
      &:focus-within .svg-diagram-actions {
        opacity: 1;
      }
    `,
    rootInline: css`
      margin-block-start: 12px;
    `,
    rootPortal: css`
      height: 100%;
    `,
  };
});
