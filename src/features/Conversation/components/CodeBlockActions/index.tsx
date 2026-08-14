'use client';

import { ActionIcon, type HighlighterProps } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ChevronsDownUpIcon, ChevronsUpDownIcon, DownloadIcon, WrapTextIcon } from 'lucide-react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HtmlPreviewAction } from '@/components/HtmlPreview';

import VisualCodeBlock from './VisualCodeBlock';
import { isHtmlCode, isSvgCode, isVisualCode } from './visualCode';

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'js',
  json: 'json',
  jsx: 'jsx',
  kotlin: 'kt',
  markdown: 'md',
  php: 'php',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  shell: 'sh',
  sql: 'sql',
  swift: 'swift',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yml',
};

const DownloadAction = memo<{ content: string; language: string; size?: any }>(
  ({ content, language, size }) => {
    const { t } = useTranslation('components');

    const handleDownload = useCallback(() => {
      // a content-detected diagram (e.g. an SVG mislabeled "plaintext") must
      // save under its effective type, not the source language, or the file
      // won't open as a diagram
      const extension = isSvgCode(content, language)
        ? 'svg'
        : isHtmlCode(content, language)
          ? 'html'
          : LANGUAGE_EXTENSIONS[language?.toLowerCase()] || language || 'txt';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `code.${extension}`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, [content, language]);

    return (
      <ActionIcon
        icon={DownloadIcon}
        onClick={handleDownload}
        size={size}
        title={t('CodeBlock.download')}
      />
    );
  },
);

/**
 * Per-block word-wrap toggle. The Highlighter's `wrap` prop is only settable
 * globally via `componentProps.highlight`, so the toggle applies inline
 * styles to this block's `pre` element (found by walking up from the action
 * button to the nearest ancestor that contains one). The effect re-applies on
 * every render so streaming updates keep the chosen state.
 */
const WrapToggleAction = memo<{ size?: any }>(({ size }) => {
  const { t } = useTranslation('components');
  const [wrapped, setWrapped] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const applyWrap = useCallback((wrap: boolean) => {
    let element: HTMLElement | null = anchorRef.current;
    while (element && !element.querySelector('pre')) element = element.parentElement;
    if (!element) return;

    for (const pre of element.querySelectorAll('pre')) {
      pre.style.whiteSpace = wrap ? 'pre-wrap' : '';
      pre.style.overflowWrap = wrap ? 'anywhere' : '';
    }
  }, []);

  useEffect(() => {
    applyWrap(wrapped);
  });

  return (
    <span ref={anchorRef} style={{ display: 'inline-flex' }}>
      <ActionIcon
        active={wrapped}
        icon={WrapTextIcon}
        onClick={() => setWrapped(!wrapped)}
        size={size}
        title={t(wrapped ? 'CodeBlock.wrapOff' : 'CodeBlock.wrap')}
      />
    </span>
  );
});

export const renderCodeBlockActions: NonNullable<HighlighterProps['actionsRender']> = ({
  actionIconSize,
  content,
  language,
  originalNode,
}) => (
  <>
    {isHtmlCode(content, language) && <HtmlPreviewAction content={content} size={actionIconSize} />}
    {/* a visual block renders no <pre> in preview mode, so the wrap toggle's
        ancestor-walk would restyle an unrelated code block — omit it */}
    {!isVisualCode(content, language) && <WrapToggleAction size={actionIconSize} />}
    <DownloadAction content={content} language={language} size={actionIconSize} />
    {originalNode}
  </>
);

const LONG_CODE_LINES = 100;
const COLLAPSED_MAX_HEIGHT = 360;

const useCollapseStyles = createStyles(({ css, token }) => ({
  collapsed: css`
    overflow: hidden;
    max-height: ${COLLAPSED_MAX_HEIGHT}px;
  `,
  container: css`
    position: relative;
  `,
  expandButton: css`
    cursor: pointer;

    position: absolute;
    z-index: 2;
    inset-block-end: 8px;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    display: flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 12px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;

    font-size: 12px;
    color: ${token.colorTextSecondary};

    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowTertiary};

    &:hover {
      color: ${token.colorText};
    }
  `,
  overlay: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset-block-end: 0;
    inset-inline: 0;

    height: 72px;

    background: linear-gradient(to bottom, transparent, ${token.colorBgContainer});
  `,
}));

const CollapsibleCodeBody = memo<{ children: React.ReactNode; lines: number }>(
  ({ children, lines }) => {
    const { styles, cx } = useCollapseStyles();
    const { t } = useTranslation('components');
    const [expanded, setExpanded] = useState(false);
    const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
    const buttonLabel = expanded
      ? t('CodeBlock.collapse')
      : t('CodeBlock.expand', { count: lines });
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        toggleExpanded();
      },
      [toggleExpanded],
    );

    return (
      <div className={cx(styles.container, !expanded && styles.collapsed)}>
        {children}
        {!expanded && <div className={styles.overlay} />}
        <div
          aria-expanded={expanded}
          aria-label={buttonLabel}
          className={styles.expandButton}
          onClick={toggleExpanded}
          onKeyDown={handleKeyDown}
          role={'button'}
          tabIndex={0}
        >
          {expanded ? <ChevronsDownUpIcon size={12} /> : <ChevronsUpDownIcon size={12} />}
          {buttonLabel}
        </div>
      </div>
    );
  },
);

/**
 * Auto-collapse very long code blocks so they don't dominate the chat
 * window; short blocks render untouched.
 */
export const renderCodeBlockBody: NonNullable<HighlighterProps['bodyRender']> = ({
  content,
  language,
  originalNode,
}) => {
  if (isVisualCode(content, language))
    return <VisualCodeBlock content={content} language={language} originalNode={originalNode} />;

  const lines = content.split('\n').length;

  if (lines <= LONG_CODE_LINES) return originalNode;

  return <CollapsibleCodeBody lines={lines}>{originalNode}</CollapsibleCodeBody>;
};
