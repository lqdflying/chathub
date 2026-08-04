'use client';

import { chunkableFileExtensions, isChunkableFile } from '@lobechat/utils';
import { Button, Dropdown, Icon, MenuProps } from '@lobehub/ui';
import { Upload } from 'antd';
import { css, cx } from 'antd-style';
import { FileUp, FolderUp, UploadIcon } from 'lucide-react';
import { useMemo } from 'react';
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

const UploadFileButton = ({
  knowledgeBaseId,
  knowledgeMode = false,
}: {
  knowledgeBaseId?: string;
  knowledgeMode?: boolean;
}) => {
  const { t } = useTranslation('file');

  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const accept = knowledgeMode ? [...chunkableFileExtensions, '.zip'].join(',') : undefined;
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
              await pushDockFileList(filterFiles([file]), knowledgeBaseId);

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
              await pushDockFileList(filterFiles([file]), knowledgeBaseId);

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
  return (
    <>
      <Dropdown menu={{ items }} placement="bottomRight">
        <Button icon={UploadIcon}>{t('header.uploadButton')}</Button>
      </Dropdown>
      <DragUpload
        enabledFiles
        onUploadFiles={(files) => pushDockFileList(filterFiles(files), knowledgeBaseId)}
      />
    </>
  );
};

export default UploadFileButton;
