'use client';

import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

import { readSandboxFileDownloads, replaceGeneratedFileDownloads } from './generatedFileDownloads';

export const SandboxFileDownloadSync = () => {
  const messages = useChatStore(chatSelectors.mainAIChatsRaw);

  useEffect(() => {
    replaceGeneratedFileDownloads(readSandboxFileDownloads(messages));
  }, [messages]);

  useEffect(() => () => replaceGeneratedFileDownloads([]), []);

  return null;
};
