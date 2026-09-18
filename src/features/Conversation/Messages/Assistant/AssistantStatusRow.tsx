import { createStyles } from 'antd-style';
import { Flexbox } from 'react-layout-kit';

import CircleLoader from '@/components/CircleLoader';
import { shinyTextStylish } from '@/styles/loading';

const useStyles = createStyles(({ token }) => ({
  shinyText: shinyTextStylish(token),
}));

const AssistantStatusRow = ({
  animated = true,
  title,
}: {
  animated?: boolean;
  title: string;
}) => {
  const { styles } = useStyles();

  return (
    <Flexbox align={'center'} gap={8} horizontal>
      {animated ? <CircleLoader /> : null}
      <Flexbox className={animated ? styles.shinyText : undefined} horizontal>
        {title}
      </Flexbox>
    </Flexbox>
  );
};

export default AssistantStatusRow;
