import { Divider } from 'antd';
import { useTheme } from 'antd-style';
import numeral from 'numeral';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

interface TokenProgressItem {
  color: string;
  id: string;
  title: string;
  value: number;
}

interface TokenProgressProps {
  compact?: boolean;
  data: TokenProgressItem[];
  hideLegend?: boolean;
  showIcon?: boolean;
  showTotal?: string;
}

const format = (number: number) => numeral(number).format('0,0');

const TokenProgress = memo<TokenProgressProps>(
  ({ compact, data, hideLegend, showIcon, showTotal }) => {
    const theme = useTheme();
    const total = data.reduce((acc, item) => acc + item.value, 0);
    const rowStyle = compact ? { fontSize: 12, lineHeight: 1.35 } : undefined;

    return (
      <Flexbox gap={compact ? 4 : 8} style={{ position: 'relative' }} width={'100%'}>
        <Flexbox
          height={compact ? 4 : 6}
          horizontal
          style={{
            background: total === 0 ? theme.colorFill : undefined,
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
          }}
          width={'100%'}
        >
          {data.map((item) => (
            <Flexbox
              height={'100%'}
              key={item.id}
              style={{ background: item.color, flex: item.value }}
            />
          ))}
        </Flexbox>
        {!hideLegend && (
          <Flexbox>
            {data.map((item) => (
              <Flexbox
                align={'center'}
                gap={4}
                horizontal
                justify={'space-between'}
                key={item.id}
                style={rowStyle}
              >
                <Flexbox align={'center'} gap={4} horizontal>
                  {showIcon && (
                    <div
                      style={{
                        background: item.color,
                        borderRadius: '50%',
                        flex: 'none',
                        height: 6,
                        width: 6,
                      }}
                    />
                  )}
                  <div style={{ color: theme.colorTextSecondary }}>{item.title}</div>
                </Flexbox>
                <div style={{ fontWeight: 500 }}>{format(item.value)}</div>
              </Flexbox>
            ))}
            {showTotal && (
              <>
                <Divider style={{ marginBlock: compact ? 4 : 8 }} />
                <Flexbox
                  align={'center'}
                  gap={4}
                  horizontal
                  justify={'space-between'}
                  style={rowStyle}
                >
                  <div style={{ color: theme.colorTextSecondary }}>{showTotal}</div>
                  <div style={{ fontWeight: 500 }}>{format(total)}</div>
                </Flexbox>
              </>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default TokenProgress;
