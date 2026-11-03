import { ActionIcon } from '@lobehub/ui';
import { Upload } from 'antd';
import { useTheme } from 'antd-style';
import { ImageUp, Wand2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import React, { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { imageToBase64 } from '@/utils/imageToBase64';
import { createUploadImageHandler } from '@/utils/uploadFIle';

const EmojiPicker = dynamic(() => import('@lobehub/ui/es/EmojiPicker'), { ssr: false });

export interface AutoGenerateAvatarProps {
  background?: string;
  canAutoGenerate?: boolean;
  /** Shown on the generate button when `canAutoGenerate` is false. */
  disabledTitle?: string;
  loading?: boolean;
  onChange?: (value: string) => void;
  onGenerate?: () => void;
  value?: string;
}

const AutoGenerateAvatar = memo<AutoGenerateAvatarProps>(
  ({ loading, background, value, onChange, onGenerate, canAutoGenerate, disabledTitle }) => {
    const { t } = useTranslation('common');
    const theme = useTheme();
    const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
    const [uploading, setUploading] = React.useState(false);

    const handleUploadAvatar = useCallback(
      createUploadImageHandler(async (dataUrl) => {
        try {
          setUploading(true);
          const img = new Image();
          img.src = dataUrl;
          await new Promise((resolve, reject) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', reject);
          });
          const webpBase64 = imageToBase64({ img, size: 256 });
          onChange?.(webpBase64);
        } finally {
          setUploading(false);
        }
      }),
      [onChange],
    );

    return (
      <Flexbox
        align={'center'}
        flex={'none'}
        gap={2}
        horizontal
        padding={2}
        style={{
          background: theme.colorBgContainer,
          border: `1px solid ${theme.colorBorderSecondary}`,
          borderRadius: 32,
          paddingRight: 8,
          width: 'fit-content',
        }}
      >
        <EmojiPicker
          background={background || theme.colorFillTertiary}
          loading={loading}
          locale={locale}
          onChange={onChange}
          size={48}
          style={{
            background: theme.colorFillTertiary,
          }}
          value={value}
        />
        <ActionIcon
          disabled={!canAutoGenerate}
          icon={Wand2}
          loading={loading}
          onClick={onGenerate}
          size="small"
          title={
            !canAutoGenerate
              ? (disabledTitle ?? t('autoGenerateTooltipDisabled'))
              : t('autoGenerate')
          }
        />
        <Upload
          accept="image/*"
          beforeUpload={handleUploadAvatar}
          itemRender={() => void 0}
          maxCount={1}
          showUploadList={false}
        >
          <ActionIcon icon={ImageUp} loading={uploading} size="small" title={t('uploadAvatar')} />
        </Upload>
      </Flexbox>
    );
  },
);

export default AutoGenerateAvatar;
