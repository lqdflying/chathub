import { Icon, Tooltip, TooltipProps } from '@lobehub/ui';
import { IconSizeType } from '@lobehub/ui/es/Icon';
import { useTheme } from 'antd-style';
import { CircleHelp } from 'lucide-react';
import { CSSProperties, MouseEvent, memo } from 'react';

const stopLabelActivation = (event: MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
};

interface InfoTooltipProps extends Omit<TooltipProps, 'children'> {
  iconStyle?: CSSProperties;
  size?: IconSizeType;
}

const InfoTooltip = memo<InfoTooltipProps>(({ size, iconStyle, ...res }) => {
  const theme = useTheme();
  return (
    <Tooltip {...res}>
      <span
        className={'chathub-form-label-tooltip'}
        onClick={stopLabelActivation}
        onClickCapture={stopLabelActivation}
        onMouseDown={stopLabelActivation}
        onMouseDownCapture={stopLabelActivation}
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
