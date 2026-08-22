import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import type { CodeInterpreterFileItem, UIChatMessage } from '@lobechat/types';
import mime from 'mime';

import { FileModel } from '@/database/models/file';
import { MessageModel } from '@/database/models/message';
import { codeInterpreterEnv } from '@/envs/codeInterpreter';
import { toPersistedConversationSessionId } from '@/server/services/conversationGeneration/inboxSession';
import { loadConversationThreadMessages } from '@/server/services/conversationGeneration/threadScope';
import { FileService } from '@/server/services/file';
import { createUploadTarget } from '@/server/services/file/uploadTarget';
import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';

import type { SandboxFile } from './types';

export const SANDBOX_GATHER_PAGE_SIZE = 1000;
export const SANDBOX_GATHER_MAX_PAGES = 50;

const basename = (filename: string) => filename.replaceAll('\\', '/').split('/').pop() || filename;

const loadConversationMessages = async ({
  db,
  groupId,
  sessionId,
  topicId,
  userId,
}: {
  db: LobeChatDatabase;
  groupId?: string | null;
  sessionId?: string | null;
  topicId?: string | null;
  userId: string;
}): Promise<UIChatMessage[]> => {
  const messageModel = new MessageModel(db, userId);
  const messages: UIChatMessage[] = [];

  for (let current = 0; current < SANDBOX_GATHER_MAX_PAGES; current += 1) {
    const page = (await messageModel.query({
      current,
      groupId: groupId || undefined,
      pageSize: SANDBOX_GATHER_PAGE_SIZE,
      sessionId: toPersistedConversationSessionId(sessionId),
      topicId: topicId || undefined,
    })) as UIChatMessage[];
    messages.push(...page);
    if (page.length < SANDBOX_GATHER_PAGE_SIZE) break;
  }

  return messages;
};

export const gatherConversationSandboxFiles = async ({
  db,
  groupId,
  sessionId,
  threadId,
  topicId,
  userId,
}: {
  db: LobeChatDatabase;
  groupId?: string | null;
  sessionId?: string | null;
  threadId?: string | null;
  topicId?: string | null;
  userId: string;
}): Promise<SandboxFile[]> => {
  const fileModel = new FileModel(db, userId);
  const fileService = new FileService(db, userId);
  const maxFileBytes = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_BYTES;
  const maxFileCount = codeInterpreterEnv.CODE_INTERPRETER_MAX_FILE_COUNT;

  const messages = await loadConversationMessages({
    db,
    groupId,
    sessionId,
    topicId,
    userId,
  });
  const scoped = await loadConversationThreadMessages(db, userId, messages, threadId);

  const pending: Array<{ filename: string; id: string }> = [];
  const seen = new Set<string>();
  const push = (id?: string, filename?: string) => {
    if (!id || seen.has(id) || pending.length >= maxFileCount) return;
    seen.add(id);
    pending.push({ filename: basename(filename || id), id });
  };

  for (let index = scoped.length - 1; index >= 0; index -= 1) {
    const message = scoped[index];
    for (const file of message.fileList ?? []) push(file.id, file.name);
    for (const image of message.imageList ?? []) push(image.id, image.alt);
    if (message.role !== 'tool') continue;
    const identifier =
      (message.plugin as { identifier?: string } | undefined)?.identifier ??
      (message as { tools?: Array<{ identifier?: string }> }).tools?.[0]?.identifier;
    if (identifier !== CodeInterpreterIdentifier || !message.content) continue;
    try {
      const prior = JSON.parse(message.content) as { files?: CodeInterpreterFileItem[] };
      for (const file of prior.files ?? []) push(file.fileId, file.filename);
    } catch {
      continue;
    }
  }

  const files: SandboxFile[] = [];
  for (const item of pending) {
    try {
      const record = await fileModel.findById(item.id);
      if (!record?.url) continue;
      const bytes = await fileService.getFileByteArray(record.url);
      if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxFileBytes) continue;
      files.push({
        content: new Uint8Array(bytes),
        filename: basename(record.name || item.filename),
      });
    } catch {
      continue;
    }
  }

  return files;
};

export const persistSandboxOutputFiles = async ({
  db,
  files,
  userId,
}: {
  db: LobeChatDatabase;
  files: SandboxFile[];
  userId: string;
}): Promise<CodeInterpreterFileItem[]> => {
  const fileModel = new FileModel(db, userId);
  const fileService = new FileService(db, userId);
  const persisted: CodeInterpreterFileItem[] = [];

  for (const file of files) {
    try {
      const buffer = Buffer.from(file.content);
      const fileHash = createHash('sha256').update(buffer).digest('hex');
      const fileType = mime.getType(file.filename) || 'application/octet-stream';
      const existing = await fileModel.checkHash(fileHash);
      let url = existing.isExist ? existing.url : undefined;
      if (!url) {
        const target = createUploadTarget({
          filename: file.filename,
          purpose: 'file',
          userId,
        });
        const uploaded = await fileService.uploadMedia(target.path, buffer);
        url = uploaded.key;
      }
      if (!url) continue;
      const { id } = await fileModel.create(
        {
          fileHash,
          fileType: existing.isExist ? (existing.fileType ?? fileType) : fileType,
          name: file.filename,
          size: existing.isExist ? (existing.size ?? buffer.byteLength) : buffer.byteLength,
          url,
        },
        !existing.isExist,
      );
      persisted.push({ fileId: id, filename: file.filename });
    } catch {
      continue;
    }
  }

  return persisted;
};
