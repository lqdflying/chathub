import { Icon, Tooltip, TooltipProps } from '@lobehub/ui';
import { IconSizeType } from '@lobehub/ui/es/Icon';
import { useTheme } from 'antd-style';
import { CircleHelp } from 'lucide-react';
import { CSSProperties, memo } from 'react';

interface InfoTooltipProps extends Omit<TooltipProps, 'children'> {
  iconStyle?: CSSProperties;
  size?: IconSizeType;
}

const InfoTooltip = memo<InfoTooltipProps>(({ size, iconStyle, ...res }) => {
  const theme = useTheme();
  return (
    <Tooltip trigger={['hover', 'click']} {...res}>
      <span
        className={'chathub-form-label-tooltip'}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Icon
          icon={CircleHelp}
          size={size}
          style={{ color: theme.colorTextTertiary, ...iconStyle }}
        />
      </span>
    </Tooltip>
  );
});

export default InfoTooltip;
