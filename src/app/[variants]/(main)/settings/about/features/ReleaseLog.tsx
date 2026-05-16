'use client';

import { Skeleton } from 'antd';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { memo } from 'react';
import useSWR from 'swr';
import { Flexbox } from 'react-layout-kit';

const RELEASE_API = 'https://api.github.com/repos/lqdflying/chathub/releases/latest';

interface ReleaseData {
  body: string;
  name: string;
  tag_name: string;
}

const ReleaseLog = memo(() => {
  const { data, error, isLoading } = useSWR<ReleaseData>(RELEASE_API, async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch release');
    const json = await res.json();
    return { body: json.body, name: json.name, tag_name: json.tag_name };
  }, { revalidateOnFocus: false });

  if (isLoading) {
    return (
      <Flexbox gap={12} style={{ maxWidth: '100%' }}>
        <Skeleton active paragraph={{ rows: 1 }} title={{ width: 200 }} />
        <Skeleton active paragraph={{ rows: 6 }} />
      </Flexbox>
    );
  }

  if (error || !data) {
    return null;
  }

  const html = DOMPurify.sanitize(marked.parse(data.body || '') as string);

  return (
    <Flexbox gap={16} style={{ maxWidth: '100%', overflow: 'hidden' }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{data.name || data.tag_name}</div>
      <div
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ fontSize: 14, lineHeight: 1.7, wordBreak: 'break-word' }}
      />
    </Flexbox>
  );
});

ReleaseLog.displayName = 'ReleaseLog';

export default ReleaseLog;
