import { createStyles } from 'antd-style';

import { buildDiagramRules } from './diagramRules';

/**
 * Theme-side half of the diagram design system: gives real values to the
 * class vocabulary the model is prompted to use (`t/ts/th/box/node/arr/leader`
 * and `c-<ramp>`). The visual rules live in `buildDiagramRules` (shared with
 * the standalone .svg export); this file adds app-only layout and interaction
 * styling. Must stay in sync with the SVG guidelines in
 * `src/tools/artifacts/systemRole.ts`.
 */
export const useStyles = createStyles(({ css, token, isDarkMode }) => ({
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
      max-width: 680px;
      height: auto;
      margin-inline: auto;
    }

    text {
      user-select: text;
    }

    .node {
      cursor: default;
    }

    ${buildDiagramRules(token, isDarkMode)}
  `,
  canvasPortal: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;

    svg {
      width: 100%;
      max-width: none;
      height: 100%;
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
}));
