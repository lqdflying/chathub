import { Icon, Segmented } from '@lobehub/ui';
import { BoltIcon, FileIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import Loading from '@/components/Loading/CircleLoading';
import FileViewer from '@/features/FileViewer';
import { lambdaQuery } from '@/libs/trpc/client';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { useFileStore } from '@/store/file';

import ChunkPager from './ChunkPager';

enum FilePreviewTab {
  Chunk = 'chunk',
  File = 'file',
}

const IMAGE_EXT_REGEX = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

const isPdfFile = (fileType?: string, name?: string) =>
  fileType?.toLowerCase() === 'pdf' || !!name?.toLowerCase().endsWith('.pdf');

const isImageFile = (fileType?: string, name?: string) =>
  fileType?.toLowerCase().startsWith('image/') || !!IMAGE_EXT_REGEX.test(name ?? '');

const FilePreview = () => {
  const previewFileId = useChatStore(chatPortalSelectors.previewFileId);
  const portalFile = useChatStore((s) => s.portalFile);
  const useFetchFileItem = useFileStore((s) => s.useFetchFileItem);
  const { t } = useTranslation('portal');

  const [tab, setTab] = useState<FilePreviewTab>(FilePreviewTab.File);
  const { data, isLoading } = useFetchFileItem(previewFileId);

  const retrievedChunks = portalFile?.chunks;
  const hasRetrievedChunks = !!retrievedChunks?.length;

  // Index of the clicked chunk within the retrieved-chunks list (Chunk tab start page).
  const chunkInitialIndex = useMemo(() => {
    if (!retrievedChunks || !portalFile?.chunkId) return 0;
    const idx = retrievedChunks.findIndex((c) => c.id === portalFile.chunkId);
    return idx >= 0 ? idx : 0;
  }, [retrievedChunks, portalFile?.chunkId]);

  // For the File tab: fetch all chunks of the file when it is a chunkable text-like
  // document (not PDF / not image). PDFs paginate via PDF.js; images render natively.
  const fileTabChunkable = !!data && !isPdfFile(data.fileType, data.name) && !isImageFile(data.fileType, data.name);
  const allChunksQuery = lambdaQuery.chunk.getAllByFileId.useQuery(
    { id: previewFileId! },
    { enabled: !!previewFileId && fileTabChunkable },
  );

  if (isLoading) return <Loading />;
  if (!data) return;

  const showChunk = tab === FilePreviewTab.Chunk && hasRetrievedChunks;

  return (
    <Flexbox
      height={'100%'}
      paddingBlock={'0 4px'}
      paddingInline={4}
      style={{ borderRadius: 4, overflow: 'hidden' }}
    >
      {hasRetrievedChunks && (
        <Segmented
          block
          onChange={(v) => setTab(v as FilePreviewTab)}
          options={[
            {
              icon: <Icon icon={BoltIcon} />,
              label: t('FilePreview.tabs.chunk'),
              value: FilePreviewTab.Chunk,
            },
            {
              icon: <Icon icon={FileIcon} />,
              label: t('FilePreview.tabs.file'),
              value: FilePreviewTab.File,
            },
          ]}
          value={tab}
          variant={'filled'}
        />
      )}

      {showChunk ? (
        <Flexbox flex={1} paddingBlock={8} style={{ minHeight: 0 }}>
          <ChunkPager chunks={retrievedChunks!} initialIndex={chunkInitialIndex} />
        </Flexbox>
      ) : fileTabChunkable ? (
        allChunksQuery.isLoading ? (
          <Loading />
        ) : allChunksQuery.data && allChunksQuery.data.length > 0 ? (
          <Flexbox flex={1} paddingBlock={8} style={{ minHeight: 0 }}>
            <ChunkPager chunks={allChunksQuery.data} initialIndex={0} />
          </Flexbox>
        ) : (
          <Flexbox flex={1} paddingBlock={8} style={{ overflow: 'scroll' }}>
            <FileViewer {...data} />
          </Flexbox>
        )
      ) : (
        <Flexbox flex={1} paddingBlock={8} style={{ overflow: 'scroll' }}>
          <FileViewer {...data} />
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default FilePreview;