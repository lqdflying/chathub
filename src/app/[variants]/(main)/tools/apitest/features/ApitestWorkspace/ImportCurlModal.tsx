'use client';

import { App, Input, Modal } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseCurl, parsedCurlToDraft } from './curl';
import type { ApiTesterRequestDraft } from './types';

const useStyles = createStyles(({ css, token }) => ({
  textarea: css`
    resize: vertical;
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
  `,
}));

interface ImportCurlModalProps {
  onClose: () => void;
  onImported: (draft: ApiTesterRequestDraft) => void;
  open: boolean;
}

const ImportCurlModal = memo<ImportCurlModalProps>(({ onClose, onImported, open }) => {
  const { styles } = useStyles();
  const { t } = useTranslation('tools');
  const { message } = App.useApp();
  const [command, setCommand] = useState('');

  const handleImport = useCallback(() => {
    const parsed = parseCurl(command);
    if (!parsed) {
      message.error(t('apitest.importCurlError'));
      return;
    }
    onImported(parsedCurlToDraft(parsed));
    setCommand('');
    onClose();
  }, [command, message, onClose, onImported, t]);

  return (
    <Modal
      okButtonProps={{ disabled: !command.trim() }}
      okText={t('apitest.importCurlConfirm')}
      onCancel={onClose}
      onOk={handleImport}
      open={open}
      title={t('apitest.importCurl')}
    >
      <Input.TextArea
        autoFocus
        className={styles.textarea}
        onChange={(e) => setCommand(e.target.value)}
        placeholder={t('apitest.importCurlPlaceholder')}
        rows={8}
        value={command}
      />
    </Modal>
  );
});

ImportCurlModal.displayName = 'ImportCurlModal';

export default ImportCurlModal;
