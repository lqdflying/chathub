'use client';

import { ActionIcon, Dropdown, Icon } from '@lobehub/ui';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import HousekeepingDialog from './HousekeepingDialog';

interface TopicToolbarProps {
  count: number;
  onCreate: () => void;
  showMoreInfo: boolean;
  showTitle: boolean;
}

const TopicToolbar = memo<TopicToolbarProps>(({ count, onCreate, showMoreInfo, showTitle }) => {
  const { t } = useTranslation('image');
  const [housekeepingOpen, setHousekeepingOpen] = useState(false);
  const actionSize = { blockSize: 44, size: 18 };

  const moreAction = (
    <Dropdown
      arrow={false}
      menu={{
        items: [
          {
            danger: true,
            icon: <Icon icon={Trash2} />,
            key: 'housekeeping',
            label: t('topic.housekeeping.action'),
            onClick: () => setHousekeepingOpen(true),
          },
        ],
      }}
      trigger={['click']}
    >
      <ActionIcon
        aria-label={t('topic.housekeeping.action')}
        icon={MoreHorizontal}
        size={actionSize}
        title={t('topic.housekeeping.action')}
      />
    </Dropdown>
  );

  return (
    <>
      {showMoreInfo ? (
        <Flexbox
          align={'center'}
          horizontal
          justify={showTitle ? 'space-between' : 'center'}
          width={'100%'}
        >
          {showTitle && (
            <span>
              {t('topic.title')} {count || ''}
            </span>
          )}
          <Flexbox gap={4} horizontal>
            <ActionIcon
              aria-label={t('topic.createNew')}
              icon={Plus}
              onClick={onCreate}
              size={actionSize}
              title={t('topic.createNew')}
            />
            {moreAction}
          </Flexbox>
        </Flexbox>
      ) : (
        <Flexbox align={'center'} gap={8}>
          <ActionIcon
            aria-label={t('topic.createNew')}
            icon={Plus}
            onClick={onCreate}
            size={{ blockSize: 48, size: 20 }}
            title={t('topic.createNew')}
            tooltipProps={{ placement: 'left' }}
            variant={'filled'}
          />
          {moreAction}
        </Flexbox>
      )}
      <HousekeepingDialog onClose={() => setHousekeepingOpen(false)} open={housekeepingOpen} />
    </>
  );
});

TopicToolbar.displayName = 'TopicToolbar';

export default TopicToolbar;
