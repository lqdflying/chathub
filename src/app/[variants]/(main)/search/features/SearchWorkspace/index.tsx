'use client';

import { ActionIcon, Text, copyToClipboard } from '@lobehub/ui';
import { useDebounce } from 'ahooks';
import { App, Button, Empty, Input, Skeleton } from 'antd';
import { createStyles } from 'antd-style';
import { Copy, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { INBOX_SESSION_ID } from '@/const/session';
import type { AccountTopicSearchHit } from '@/database/models/topic';
import { topicService } from '@/services/topic';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { formatTopicActivityTime } from '@/utils/client/topic';

const useStyles = createStyles(({ css, token }) => ({
  hit: css`
    padding: 12px 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorBgContainer};
  `,
  id: css`
    font-family: ${token.fontFamilyCode};
  `,
  mark: css`
    padding: 0;
    background: ${token.colorWarningBg};
  `,
  snippet: css`
    white-space: pre-wrap;
  `,
}));

const Highlight = ({ keyword, text }: { keyword: string; text: string }) => {
  const { styles } = useStyles();
  const needle = keyword.trim();
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (!needle || index < 0) return <>{text}</>;

  const end = index + needle.length;
  return (
    <>
      {text.slice(0, index)}
      <mark className={styles.mark}>{text.slice(index, end)}</mark>
      {text.slice(end)}
    </>
  );
};

const topicHref = (hit: AccountTopicSearchHit) => {
  const params = new URLSearchParams();
  params.set('session', hit.containerId || INBOX_SESSION_ID);
  params.set('topic', hit.id);
  return `/chat?${params.toString()}`;
};

const SearchWorkspace = memo(() => {
  const { t } = useTranslation('search');
  const { styles } = useStyles();
  const { message } = App.useApp();
  const router = useRouter();
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const [keyword, setKeyword] = useState('');
  const [hits, setHits] = useState<AccountTopicSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounce(keyword, { wait: 300 });

  useEffect(() => {
    const query = debounced.trim();
    if (!query) {
      setHits([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void topicService
      .searchAccountTopics(query)
      .then((next) => {
        if (!cancelled) setHits(next);
      })
      .catch(() => {
        if (!cancelled) setHits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const query = debounced.trim();

  return (
    <Flexbox gap={16} width={'100%'}>
      <Input
        allowClear
        autoFocus
        onChange={(event) => setKeyword(event.target.value)}
        placeholder={t('placeholder')}
        prefix={<Search size={16} />}
        size={'large'}
        value={keyword}
      />
      {loading && <Skeleton active paragraph={{ rows: 4 }} />}
      {!loading && query && hits.length === 0 && <Empty description={t('empty')} />}
      {!loading && !query && <Empty description={t('idle')} />}
      {!loading &&
        hits.map((hit) => {
          const activity = formatTopicActivityTime(new Date(hit.lastActivityAt).getTime(), locale);
          return (
            <Flexbox className={styles.hit} gap={8} key={hit.id}>
              <Flexbox align={'center'} gap={8} horizontal justify={'space-between'}>
                <Text ellipsis weight={500}>
                  <Highlight keyword={query} text={hit.title || hit.id} />
                </Text>
                <Text type={'secondary'}>{activity}</Text>
              </Flexbox>
              <Flexbox align={'center'} gap={8} horizontal>
                {hit.containerTitle && <Text type={'secondary'}>{hit.containerTitle}</Text>}
                <Text className={styles.id} type={'secondary'}>
                  {hit.id}
                </Text>
              </Flexbox>
              {hit.snippet && (
                <Text className={styles.snippet} type={'secondary'}>
                  <Highlight keyword={query} text={hit.snippet} />
                </Text>
              )}
              <Flexbox gap={8} horizontal>
                <Button onClick={() => router.push(topicHref(hit))} type={'primary'}>
                  {t('open')}
                </Button>
                <ActionIcon
                  icon={Copy}
                  onClick={() => {
                    void copyToClipboard(hit.id).then(() => {
                      message.success(t('copySuccess'));
                    });
                  }}
                  title={t('copyId')}
                />
              </Flexbox>
            </Flexbox>
          );
        })}
    </Flexbox>
  );
});

SearchWorkspace.displayName = 'SearchWorkspace';

export default SearchWorkspace;
