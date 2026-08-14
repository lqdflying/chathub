'use client';

import { sanitizeSVGContent } from '@lobechat/utils/client';
import { type ReactNode, memo, useMemo, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';

import Actions from './Actions';
import { useStyles } from './styles';

interface SVGDiagramProps {
  /** extra action buttons rendered before the shared download/copy actions */
  children?: ReactNode;
  /** untrusted SVG source; sanitized before rendering */
  content: string;
  title?: string;
  variant?: 'inline' | 'portal';
}

/**
 * Renders an AI-drawn SVG diagram with the diagram design-system stylesheet
 * applied, so class-based (`c-*`, `t/ts/th/box/arr`) diagrams adapt to the
 * app theme in both light and dark mode. Used inline in chat bubbles and in
 * the artifacts portal.
 */
const SVGDiagram = memo<SVGDiagramProps>(({ children, content, title, variant = 'inline' }) => {
  const { styles, cx } = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);

  const sanitizedContent = useMemo(() => sanitizeSVGContent(content), [content]);

  if (!sanitizedContent.trim()) return null;

  const isPortal = variant === 'portal';

  return (
    <Flexbox
      className={cx(styles.root, isPortal ? styles.rootPortal : styles.rootInline)}
      width={'100%'}
    >
      <div
        className={cx(styles.canvas, isPortal && styles.canvasPortal)}
        dangerouslySetInnerHTML={{ __html: sanitizedContent }} // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- content is sanitized by sanitizeSVGContent()
        ref={containerRef}
      />
      <Flexbox
        className={cx(isPortal ? styles.actionsPortal : styles.actionsInline, 'svg-diagram-actions')}
        gap={4}
        horizontal
      >
        {children}
        <Actions
          content={sanitizedContent}
          getContainer={() => containerRef.current}
          title={title}
        />
      </Flexbox>
    </Flexbox>
  );
});

export default SVGDiagram;
