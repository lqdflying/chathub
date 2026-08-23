import { CodeInterpreterFileItem } from '@lobechat/types';
import { Image } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import { ResultFileCard } from './ResultFileItem';

const useStyles = createStyles(({ css }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
    gap: 12px;
  `,
}));

const ResultFileGallery = memo<{ files: CodeInterpreterFileItem[] }>(({ files }) => {
  const { styles } = useStyles();

  if (!files || files.length === 0) {
    return null;
  }

  return (
    <Image.PreviewGroup>
      <Flexbox className={styles.grid}>
        {files.map((file, index) => (
          <ResultFileCard key={`${file.fileId ?? file.filename}-${index}`} {...file} />
        ))}
      </Flexbox>
    </Image.PreviewGroup>
  );
});

export default ResultFileGallery;
