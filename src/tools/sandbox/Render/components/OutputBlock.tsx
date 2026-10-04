import { Text } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

// Caps each block so a runaway command cannot bloat the DOM.
const MAX_OUTPUT_CHARS = 50_000;

export const clipOutput = (value: string) =>
  value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]` : value;

interface OutputBlockProps {
  items: Array<{ data: string; type: 'stderr' | 'stdout' }>;
  title?: string;
}

/** stdout and stderr in one monospace block; stderr is highlighted. */
const OutputBlock = memo<OutputBlockProps>(({ items, title }) => {
  const theme = useTheme();
  const visible = items.filter((item) => item.data);
  if (visible.length === 0) return null;

  return (
    <Flexbox>
      {title && (
        <Text strong style={{ marginBottom: 4 }}>
          {title}
        </Text>
      )}
      <div
        style={{
          backgroundColor: theme.colorBgContainer,
          border: `1px solid ${theme.colorBorder}`,
          borderRadius: theme.borderRadius,
          fontSize: 13,
          lineHeight: 1.5,
          maxHeight: 400,
          overflow: 'auto',
          padding: 12,
          whiteSpace: 'pre',
        }}
      >
        {visible.map((item, index) => (
          <Text code key={index} type={item.type === 'stderr' ? 'danger' : undefined}>
            {clipOutput(item.data)}
            {index < visible.length - 1 ? '\n' : ''}
          </Text>
        ))}
      </div>
    </Flexbox>
  );
});

export default OutputBlock;
