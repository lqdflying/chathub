'use client';

import { copyImageToClipboard } from '@lobechat/utils/client';
import { Button, Dropdown, Tooltip } from '@lobehub/ui';
import { App, Space } from 'antd';
import { useTheme } from 'antd-style';
import { CopyIcon, DownloadIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BRANDING_NAME } from '@/const/branding';

interface ActionsProps {
  /** sanitized SVG source, used for the .svg download */
  content: string;
  getContainer: () => HTMLElement | null;
  title?: string;
}

const Actions = memo<ActionsProps>(({ content, getContainer, title }) => {
  const { t } = useTranslation('portal');
  const { message } = App.useApp();
  const theme = useTheme();

  const generatePng = async () => {
    const container = getContainer();
    if (!container) throw new Error('SVG container not found');

    const { domToPng } = await import('modern-screenshot');

    return domToPng(container, {
      // a transparent capture turns black in most PNG viewers on dark mode
      backgroundColor: theme.colorBgContainer,
      features: {
        // 不启用移除控制符，否则会导致 safari emoji 报错
        removeControlCharacter: false,
      },
      scale: 2,
    });
  };

  const downloadImage = async (type: string) => {
    let dataUrl = '';
    if (type === 'png') dataUrl = await generatePng();
    else if (type === 'svg') {
      const blob = new Blob([content], { type: 'image/svg+xml' });

      dataUrl = URL.createObjectURL(blob);
    }

    const link = document.createElement('a');
    link.download = `${BRANDING_NAME}_${title || 'diagram'}.${type}`;
    link.href = dataUrl;
    link.click();
    link.remove();
    if (type === 'svg') URL.revokeObjectURL(dataUrl);
  };

  return (
    <Space.Compact>
      <Dropdown
        menu={{
          items: [
            { key: 'png', label: t('artifacts.svg.download.png') },
            { key: 'svg', label: t('artifacts.svg.download.svg') },
          ],
          onClick: ({ key }) => {
            downloadImage(key);
          },
        }}
      >
        <Button icon={DownloadIcon} size={'small'} />
      </Dropdown>
      <Tooltip title={t('artifacts.svg.copyAsImage')}>
        <Button
          icon={CopyIcon}
          onClick={async () => {
            const dataUrl = await generatePng();
            try {
              await copyImageToClipboard(dataUrl);
              message.success(t('artifacts.svg.copySuccess'));
            } catch (e) {
              message.error(t('artifacts.svg.copyFail', { error: e }));
            }
          }}
          size={'small'}
        />
      </Tooltip>
    </Space.Compact>
  );
});

export default Actions;
