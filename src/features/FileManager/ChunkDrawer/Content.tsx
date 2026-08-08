import { SearchBar } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { fileManagerSelectors, useFileStore } from '@/store/file';
import { fileChunkSelectors } from '@/store/file/slices/chunk';

import ChunkList from './ChunkList';
import FileBasicInfo from './FileBasicInfo';
import SimilaritySearchList from './SimilaritySearchList';

const useStyles = createStyles(({ css, token }) => ({
  basicInfo: css`
    flex-shrink: 0;
    max-block-size: min(40%, 360px);
    overflow-y: auto;
    padding: 12px;
    border-block-end: 1px solid ${token.colorSplit};
    background: ${token.colorBgLayout};
  `,
  search: css`
    margin-block-start: 8px;
  `,
}));

const Content = memo(() => {
  const { styles } = useStyles();
  const [fileId, showSimilaritySearch, semanticSearch] = useFileStore((s) => [
    fileChunkSelectors.enabledChunkFileId(s),
    fileChunkSelectors.showSimilaritySearchResult(s),
    s.semanticSearch,
  ]);
  const file = useFileStore(fileManagerSelectors.getFileById(fileId));

  if (!fileId || !file) return;

  return (
    <Flexbox height={'100%'}>
      <div className={styles.basicInfo}>
        <FileBasicInfo file={file} variant={'compact'} />
      </div>
      <Flexbox className={styles.search} paddingInline={12}>
        <SearchBar
          onChange={(text) => {
            if (!text) useFileStore.setState({ isSimilaritySearch: false });
          }}
          onSearch={async (text) => {
            useFileStore.setState({ isSimilaritySearch: !!text });
            semanticSearch(text, fileId);
          }}
          variant={'filled'}
        />
      </Flexbox>
      <Flexbox flex={1} paddingBlock={'8px 0'} style={{ minHeight: 0 }}>
        {showSimilaritySearch ? (
          <SimilaritySearchList />
        ) : (
          <ChunkList fileId={fileId} fileType={file.fileType} key={fileId} name={file.name} />
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Content;
