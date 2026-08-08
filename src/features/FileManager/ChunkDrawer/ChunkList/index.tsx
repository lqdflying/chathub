import { isChunkableFile } from '@lobechat/utils';
import { Button, Empty } from '@lobehub/ui';
import { FileBoxIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';

import ChunkPager from '@/features/ChunkPager';
import { lambdaQuery } from '@/libs/trpc/client';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

import SkeletonLoading from '../Loading';
import ChunkItem from './ChunkItem';

interface ChunkListProps {
  fileId: string;
  fileType: string;
  name: string;
}
const ChunkList = memo<ChunkListProps>(({ fileId, fileType, name }) => {
  const { t } = useTranslation('components');
  const canParseFile = isChunkableFile(name, fileType);
  // The file list polls task status every 5s while any task is processing, so
  // the store's chunkingStatus is live even with the drawer open. A re-parse
  // only replaces rows in the DB at task completion — poll while processing
  // and refetch once when it flips off, otherwise the drawer keeps showing the
  // pre-re-parse chunks (or nothing, for a first parse) until reopened.
  const chunkingStatus = useFileStore(
    (s) => fileManagerSelectors.getFileById(fileId)(s)?.chunkingStatus,
  );
  const isProcessing = chunkingStatus === AsyncTaskStatus.Processing;
  const isCreatingParseTask = useFileStore(fileManagerSelectors.isCreatingFileParseTask(fileId));
  const parseFilesToChunks = useFileStore((s) => s.parseFilesToChunks);
  const isParsing = isProcessing || isCreatingParseTask;

  const { data, isLoading, refetch } = lambdaQuery.chunk.getAllByFileId.useQuery(
    { id: fileId },
    {
      refetchInterval: isProcessing ? 3000 : false,
      staleTime: 5 * 60 * 1000,
    },
  );

  const wasProcessing = useRef(isProcessing);
  const [page, setPage] = useState(1);
  useEffect(() => {
    if (wasProcessing.current && !isProcessing) refetch();
    wasProcessing.current = isProcessing;
  }, [isProcessing, refetch]);

  const dataSource = data || [];
  const effectivePage = Math.min(Math.max(page, 1), Math.max(dataSource.length, 1));
  const currentChunk = dataSource[effectivePage - 1];

  return isLoading ? (
    <SkeletonLoading />
  ) : currentChunk ? (
    <Flexbox flex={1} style={{ minHeight: 0 }}>
      <ChunkItem
        id={currentChunk.id}
        index={currentChunk.index ?? effectivePage - 1}
        metadata={currentChunk.metadata}
        text={currentChunk.text}
        type={currentChunk.type}
      />
      <ChunkPager chunks={dataSource} key={fileId} onPageChange={setPage} />
    </Flexbox>
  ) : (
    <Center flex={1} height={'100%'} padding={24}>
      <Empty
        description={t(
          isParsing
            ? 'FileManager.chunkEmpty.processing'
            : canParseFile
              ? 'FileManager.chunkEmpty.description'
              : 'FileManager.chunkEmpty.unsupported',
        )}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        {canParseFile && (
          <Button
            disabled={isParsing}
            icon={FileBoxIcon}
            loading={isParsing}
            onClick={() => parseFilesToChunks([fileId])}
          >
            {t(isParsing ? 'FileManager.chunkEmpty.parsing' : 'FileManager.chunkEmpty.parse')}
          </Button>
        )}
      </Empty>
    </Center>
  );
});

export default ChunkList;
