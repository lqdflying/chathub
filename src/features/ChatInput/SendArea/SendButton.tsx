import { SendButton as Send } from '@lobehub/editor/react';
import { Button } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import StopLoadingIcon from '@/components/StopLoading';

import { selectors, useChatInputStore } from '../store';

const useStyles = createStyles(({ css, prefixCls }) => ({
  stop: css`
    &.${prefixCls}-btn {
      flex: none;
      width: 32px;
      height: 32px;
      padding-inline: 0 !important;
    }
  `,
}));

const SendButton = memo(() => {
  const { styles } = useStyles();
  const sendMenu = useChatInputStore((s) => s.sendMenu);
  const shape = useChatInputStore((s) => s.sendButtonProps?.shape);
  const { generating, disabled } = useChatInputStore(selectors.sendButtonProps, isEqual);
  const [send, handleStop] = useChatInputStore((s) => [s.handleSendButton, s.handleStop]);

  if (generating) {
    return (
      <Button
        aria-label={'Stop'}
        className={styles.stop}
        data-testid={'chat-send-stop'}
        icon={<StopLoadingIcon size={24} />}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleStop();
        }}
        shape={shape}
        type={'primary'}
      />
    );
  }

  return (
    <Send
      disabled={disabled}
      generating={false}
      menu={sendMenu as any}
      onClick={() => send()}
      placement={'topRight'}
      shape={shape}
      trigger={['hover']}
    />
  );
});

SendButton.displayName = 'SendButton';

export default SendButton;
