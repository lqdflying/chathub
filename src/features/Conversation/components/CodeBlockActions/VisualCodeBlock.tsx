'use client';

import { Segmented } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Code2, Eye } from 'lucide-react';
import React, { type ReactNode, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { injectSandboxShim, isSvgCode, isVisualComplete } from './visualCode';

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow: hidden;

    margin-block: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;

    background: ${token.colorBgContainer};
  `,
  iframe: css`
    display: block;
    width: 100%;
    height: min(70vh, 480px);
    border: none;
  `,
  toolbar: css`
    padding-block: 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${token.colorBorderSecondary};
  `,
}));

// Wrap a standalone SVG in a minimal responsive HTML document so it scales to
// the frame instead of rendering at its intrinsic size.
const wrapSvg = (svg: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%;height:auto}</style></head><body>${svg}</body></html>`;

const modeLabel = (icon: ReactNode, text: string): ReactNode => (
  <Flexbox align={'center'} gap={6} horizontal>
    {icon}
    {text}
  </Flexbox>
);

interface VisualCodeBlockProps {
  content: string;
  language: string;
  originalNode: ReactNode;
}

/**
 * Renders an `html`/`svg` fenced code block as its rendered visual by default,
 * with a toggle back to the source. The visual runs in an iframe sandboxed to
 * `allow-scripts` only (opaque origin — no access to app cookies, storage or
 * DOM), so arbitrary model markup is isolated from the app while keeping full
 * visual fidelity (gradients, CSS, scripts).
 */
const VisualCodeBlock = memo<VisualCodeBlockProps>(({ content, language, originalNode }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('components');

  const isSvg = isSvgCode(content, language);
  const complete = isVisualComplete(content, language);

  // default to source while streaming; auto-flip to rendered when complete,
  // until the user picks a mode — then their choice sticks across stream ticks
  const touchedRef = useRef(false);
  const [mode, setMode] = useState<'render' | 'source'>(complete ? 'render' : 'source');

  useEffect(() => {
    if (touchedRef.current) return;
    setMode(complete ? 'render' : 'source');
  }, [complete]);

  // HTML docs get the storage shim so embedded scripts (e.g. mermaid-in-HTML)
  // survive the opaque-origin sandbox instead of hanging on a stuck spinner; the
  // SVG wrapper is our own inert document and needs none.
  const srcDoc = useMemo(
    () => (isSvg ? wrapSvg(content) : injectSandboxShim(content)),
    [isSvg, content],
  );

  return (
    <Flexbox className={styles.container}>
      <Flexbox align={'center'} className={styles.toolbar} horizontal justify={'flex-end'}>
        <Segmented
          onChange={(v) => {
            touchedRef.current = true;
            setMode(v as 'render' | 'source');
          }}
          options={[
            { label: modeLabel(<Eye size={16} />, t('HtmlPreview.mode.preview')), value: 'render' },
            { label: modeLabel(<Code2 size={16} />, t('HtmlPreview.mode.code')), value: 'source' },
          ]}
          size={'small'}
          value={mode}
        />
      </Flexbox>
      {mode === 'render' ? (
        <iframe
          className={styles.iframe}
          referrerPolicy={'no-referrer'}
          sandbox={'allow-scripts'}
          srcDoc={srcDoc}
          title={t('HtmlPreview.iframeTitle')}
        />
      ) : (
        originalNode
      )}
    </Flexbox>
  );
});

VisualCodeBlock.displayName = 'VisualCodeBlock';

export default VisualCodeBlock;
