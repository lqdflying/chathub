'use client';

import { getChunkableFileExtensions, isChunkableFile } from '@lobechat/utils';
import { ActionIcon, Button, Dropdown, Icon, MenuProps } from '@lobehub/ui';
import { Upload } from 'antd';
import { css, cx } from 'antd-style';
import { FileUp, FolderUp, UploadIcon } from 'lucide-react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import DragUpload from '@/components/DragUpload';
import { useFileStore } from '@/store/file';

const hotArea = css`
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: transparent;
  }
`;

const isZipFile = (file: File) =>
  file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip');

const filterKnowledgeUploads = (files: File[]) =>
  files.filter((file) => isZipFile(file) || isChunkableFile(file.name, file.type));

interface UploadFileButtonProps {
  knowledgeBaseId?: string;
  knowledgeMode?: boolean;
  mobile?: boolean;
}

const UploadFileButton = ({
  knowledgeBaseId,
  knowledgeMode = false,
  mobile = false,
}: UploadFileButtonProps) => {
  const { t } = useTranslation('file');

  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const accept = knowledgeMode ? [...getChunkableFileExtensions(), '.zip'].join(',') : undefined;
  const filterFiles = (files: File[]) => (knowledgeMode ? filterKnowledgeUploads(files) : files);
  const items = useMemo<MenuProps['items']>(
    () => [
      {
        icon: <Icon icon={FileUp} />,
        key: 'upload-file',
        label: (
          <Upload
            accept={accept}
            beforeUpload={async (file) => {
              await pushDockFileList(filterFiles([file]), knowledgeBaseId, knowledgeMode);

              return false;
            }}
            multiple={true}
            showUploadList={false}
          >
            <div className={cx(hotArea)}>{t('header.actions.uploadFile')}</div>
          </Upload>
        ),
      },
      {
        icon: <Icon icon={FolderUp} />,
        key: 'upload-folder',
        label: (
          <Upload
            accept={accept}
            beforeUpload={async (file) => {
              await pushDockFileList(filterFiles([file]), knowledgeBaseId, knowledgeMode);

              return false;
            }}
            directory
            multiple={true}
            showUploadList={false}
          >
            <div className={cx(hotArea)}>{t('header.actions.uploadFolder')}</div>
          </Upload>
        ),
      },
    ],
    [accept, knowledgeBaseId, knowledgeMode, pushDockFileList, t],
  );

  const trigger = mobile ? (
    <ActionIcon icon={UploadIcon} title={t('header.uploadButton')} />
  ) : (
    <Button icon={UploadIcon}>{t('header.uploadButton')}</Button>
  );

  return (
    <>
      <Dropdown menu={{ items }} placement="bottomRight">
        {trigger}
      </Dropdown>
      <DragUpload
        enabledFiles
        onUploadFiles={(files) =>
          pushDockFileList(filterFiles(files), knowledgeBaseId, knowledgeMode)
        }
      />
    </>
  );
};

export default UploadFileButton;
