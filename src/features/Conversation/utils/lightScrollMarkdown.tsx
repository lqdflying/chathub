import { MarkdownProps } from '@lobehub/ui';
import { type ReactNode } from 'react';

const LightCode = ({ content }: { content?: string }) => <pre>{content}</pre>;

/** Skip Shiki / mermaid while scrolling. Keep remark so layout stays close. */
export const applyLightScrollMarkdownProps = (
  markdownProps: Omit<MarkdownProps, 'className' | 'style' | 'children'>,
  isScrolling?: boolean,
): Omit<MarkdownProps, 'className' | 'style' | 'children'> => {
  if (!isScrolling) return markdownProps;

  return {
    ...markdownProps,
    animated: false,
    componentProps: {
      ...markdownProps.componentProps,
      highlight: {
        bodyRender: ({ content }: { content?: string }) => <LightCode content={content} />,
      },
      mermaid: {
        bodyRender: ({ originalNode }: { originalNode?: ReactNode }) => originalNode ?? null,
        enablePanZoom: false,
      },
    },
  };
};
