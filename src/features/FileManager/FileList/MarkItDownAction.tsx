import { isMarkItDownConvertibleFile } from '@lobechat/utils';
import { Button, Tooltip } from '@lobehub/ui';
import { App } from 'antd';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFileStore } from '@/store/file';

interface MarkItDownActionProps {
  fileType?: string;
  id: string;
  name: string;
  size?: 'small';
  variant?: 'button' | 'floating';
}

/**
 * Per-file MarkItDown entry point, shown only when the deployment has a
 * MarkItDown sidecar configured and this file is convertible by it. Clicking
 * re-parses the file via MarkItDown (forced `service: 'markitdown'`) and opens
 * the chunk drawer so the converted content is visible immediately.
 */
const MarkItDownAction = memo<MarkItDownActionProps>(({ id, name, fileType }) => {
  const { t } = useTranslation('components');
  const { modal } = App.useApp();
  const [reParseFileWithMarkItDown, openChunkDrawer] = useFileStore((s) => [
    s.reParseFileWithMarkItDown,
    s.openChunkDrawer,
  ]);

  if (!isMarkItDownConvertibleFile(name, fileType)) return null;

  const handleClick = () => {
    modal.confirm({
      content: t('FileManager.actions.confirmMarkItDown'),
      onOk: async () => {
        await reParseFileWithMarkItDown(id);
        openChunkDrawer(id);
      },
      title: t('FileManager.actions.markitdown'),
    });
  };

  return (
    <Tooltip title={t('FileManager.actions.markitdownTooltip')}>
      <Button
        icon={FileTextIcon}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
        size={'small'}
        type={'text'}
      />
    </Tooltip>
  );
});

export default MarkItDownAction;
