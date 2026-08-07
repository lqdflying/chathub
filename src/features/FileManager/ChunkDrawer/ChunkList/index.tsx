import { memo, useEffect, useRef } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Virtuoso } from 'react-virtuoso';

import { lambdaQuery } from '@/libs/trpc/client';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { AsyncTaskStatus } from '@/types/asyncTask';

import SkeletonLoading from '../Loading';
import ChunkItem from './ChunkItem';

interface ChunkListProps {
  fileId: string;
}
const ChunkList = memo<ChunkListProps>(({ fileId }) => {
  // The file list polls task status every 5s while any task is processing, so
  // the store's chunkingStatus is live even with the drawer open. A re-parse
  // only replaces rows in the DB at task completion — poll while processing
  // and refetch once when it flips off, otherwise the drawer keeps showing the
  // pre-re-parse chunks (or nothing, for a first parse) until reopened.
  const chunkingStatus = useFileStore(
    (s) => fileManagerSelectors.getFileById(fileId)(s)?.chunkingStatus,
  );
  const isProcessing = chunkingStatus === AsyncTaskStatus.Processing;

  const { data, isLoading, fetchNextPage, refetch } =
    lambdaQuery.chunk.getChunksByFileId.useInfiniteQuery(
      { id: fileId },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchInterval: isProcessing ? 3000 : false,
      },
    );

  const wasProcessing = useRef(isProcessing);
  useEffect(() => {
    if (wasProcessing.current && !isProcessing) refetch();
    wasProcessing.current = isProcessing;
  }, [isProcessing, refetch]);

  const dataSource = data?.pages.flatMap((page) => page.items) || [];

  return isLoading ? (
    <SkeletonLoading />
  ) : (
    <Flexbox flex={1}>
      <Virtuoso
        data={dataSource}
        endReached={() => {
          fetchNextPage();
        }}
        itemContent={(index, item) => (
          <Flexbox key={item.id} paddingInline={12}>
            <ChunkItem {...item} index={index} />
          </Flexbox>
        )}
      />
    </Flexbox>
  );
});

export default ChunkList;
