import { ActionIcon, TextArea } from '@lobehub/ui';
import { SafeArea } from '@lobehub/ui/mobile';
import { useSize } from 'ahooks';
import { createStyles } from 'antd-style';
import { TextAreaRef } from 'antd/es/input/TextArea';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { rgba } from 'polished';
import { CSSProperties, ReactNode, forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  MAIN_PASTED_TEXT_SCOPE,
  captureLargePlainPaste,
  createShiftPasteBypassTracker,
} from '@/features/ChatInput/pastedText';

import InnerContainer from './Container';

const useStyles = createStyles(({ css, token }) => {
  return {
    container: css`
      flex: none;

      padding-block: 10px calc(10px + env(safe-area-inset-bottom));
      border-block-start: 1px solid ${rgba(token.colorBorder, 0.25)};

      background: ${token.colorBgContainer};
      box-shadow: 0 -1px 0 ${token.colorFillQuaternary};
    `,
    expand: css`
      position: absolute;
      height: 100%;
      padding-block: 12px calc(12px + env(safe-area-inset-bottom));
      background: ${token.colorBgContainer};
    `,
    expandButton: css`
      position: absolute;
      z-index: 1;
      inset-inline-start: 16px;
    `,
    textarea: css`
      flex: 1;
      border-radius: ${token.borderRadiusLG}px;
      transition: none !important;
    `,
  };
});

export interface MobileChatInputAreaProps {
  bottomAddons?: ReactNode;
  className?: string;
  expand?: boolean;
  loading?: boolean;
  onInput?: (value: string) => void;
  onSend?: () => void;
  pastedAddons?: ReactNode;
  safeArea?: boolean;
  setExpand?: (expand: boolean) => void;
  style?: CSSProperties;
  textAreaLeftAddons?: ReactNode;
  textAreaRightAddons?: ReactNode;
  topAddons?: ReactNode;
  value: string;
}

const MobileChatInputArea = forwardRef<TextAreaRef, MobileChatInputAreaProps>(
  (
    {
      className,
      style,
      topAddons,
      textAreaLeftAddons,
      textAreaRightAddons,
      bottomAddons,
      expand = false,
      setExpand,
      onSend,
      onInput,
      loading,
      pastedAddons,
      value,
      safeArea,
    },
    ref,
  ) => {
    const { t } = useTranslation('chat');
    const isChineseInput = useRef(false);
    const pasteBypassTracker = useRef(createShiftPasteBypassTracker());
    const containerRef = useRef<HTMLDivElement>(null);
    const { cx, styles } = useStyles();
    const size = useSize(containerRef);
    const [showFullscreen, setShowFullscreen] = useState<boolean>(false);
    const [isFocused, setIsFocused] = useState<boolean>(false);

    useEffect(() => {
      if (!size?.height) return;
      setShowFullscreen(size.height > 72);
    }, [size]);

    const showAddons = !expand && !isFocused;

    return (
      <Flexbox
        className={cx(styles.container, expand && styles.expand, className)}
        gap={10}
        style={style}
      >
        {topAddons && <Flexbox style={showAddons ? {} : { display: 'none' }}>{topAddons}</Flexbox>}
        {pastedAddons}
        <Flexbox
          className={cx(expand && styles.expand)}
          ref={containerRef}
          style={{ position: 'relative' }}
        >
          {showFullscreen && (
            <ActionIcon
              active
              className={styles.expandButton}
              icon={expand ? ChevronDown : ChevronUp}
              onClick={() => setExpand?.(!expand)}
              size={{ blockSize: 24, borderRadius: '50%', size: 14 }}
              style={expand ? { top: 8 } : {}}
            />
          )}
          <InnerContainer
            bottomAddons={bottomAddons}
            expand={expand}
            textAreaLeftAddons={textAreaLeftAddons}
            textAreaRightAddons={textAreaRightAddons}
            topAddons={topAddons}
          >
            <TextArea
              autoSize={expand ? false : { maxRows: 6, minRows: 0 }}
              className={styles.textarea}
              onBlur={(e) => {
                pasteBypassTracker.current.reset();
                onInput?.(e.target.value);
                setIsFocused(false);
              }}
              onChange={(e) => {
                onInput?.(e.target.value);
              }}
              onCompositionEnd={() => {
                isChineseInput.current = false;
              }}
              onCompositionStart={() => {
                isChineseInput.current = true;
              }}
              onFocus={() => setIsFocused(true)}
              onKeyDown={(event) => {
                pasteBypassTracker.current.onKeyDown(event.nativeEvent);
              }}
              onKeyUp={(event) => {
                pasteBypassTracker.current.onKeyUp(event.nativeEvent);
              }}
              onPaste={(event) => {
                captureLargePlainPaste(event, {
                  bypass: pasteBypassTracker.current.consumeBypass(),
                  scope: MAIN_PASTED_TEXT_SCOPE,
                });
              }}
              onPressEnter={(e) => {
                if (!loading && !isChineseInput.current && e.shiftKey) {
                  e.preventDefault();
                  onSend?.();
                }
              }}
              placeholder={t('sendPlaceholder')}
              ref={ref}
              style={{ height: 38, paddingBlock: 7 }}
              value={value}
              variant={expand ? 'borderless' : 'filled'}
            />
          </InnerContainer>
        </Flexbox>
        {bottomAddons && (
          <Flexbox style={showAddons ? {} : { display: 'none' }}>{bottomAddons}</Flexbox>
        )}
        {safeArea && !isFocused && <SafeArea position={'bottom'} />}
      </Flexbox>
    );
  },
);

export default MobileChatInputArea;
