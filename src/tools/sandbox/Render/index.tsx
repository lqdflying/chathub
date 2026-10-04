import { BuiltinRenderProps, SandboxToolResult, SandboxToolState } from '@lobechat/types';
import { Alert, Highlighter, Tag, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import BubblesLoading from '@/components/BubblesLoading';
import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/slices/builtinTool/selectors';

import { SandboxApiName, resolveSandboxApiName } from '../const';
import OutputBlock, { clipOutput } from './components/OutputBlock';
import ResultFileGallery from './components/ResultFileGallery';
import { languageForPath } from './components/language';

type SandboxArgs = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const CodeView = memo<{ code: string; language: string; maxHeight?: number }>(
  ({ code, language, maxHeight = 200 }) => (
    <Highlighter
      actionIconSize="small"
      language={language}
      showLanguage={false}
      style={{ maxHeight, overflow: 'scroll', width: '100%' }}
    >
      {clipOutput(code)}
    </Highlighter>
  ),
);

const PythonView = memo<{ args: SandboxArgs; content?: SandboxToolResult; done: boolean }>(
  ({ args, content, done }) => {
    const { t } = useTranslation('tool');
    const hasOutput = !!(content?.result || content?.output?.length || content?.files?.length);

    return (
      <Flexbox gap={12}>
        <CodeView code={text(args.code)} language="python" />
        {done && content && !hasOutput && !content.error && (
          <Text type="secondary">{t('codeInterpreter.noOutput')}</Text>
        )}
        {done && content?.result && (
          <Flexbox>
            <Text strong style={{ marginBottom: 4 }}>
              {t('codeInterpreter.returnValue')}
            </Text>
            <Highlighter copyable={false} language="text" showLanguage={false}>
              {content.result}
            </Highlighter>
          </Flexbox>
        )}
        {done && content?.output && (
          <OutputBlock items={content.output} title={t('codeInterpreter.output')} />
        )}
        {done && content?.files && content.files.length > 0 && (
          <Flexbox>
            <Text strong style={{ marginBottom: 8 }}>
              {t('codeInterpreter.files')}
            </Text>
            <ResultFileGallery files={content.files} />
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

const CommandView = memo<{ args: SandboxArgs; content?: SandboxToolResult; done: boolean }>(
  ({ args, content, done }) => {
    const { t } = useTranslation('tool');

    return (
      <Flexbox gap={12}>
        <CodeView code={text(args.command)} language="bash" />
        {done && content && (
          <Flexbox gap={8} horizontal wrap="wrap">
            {text(args.cwd) && <Tag>{text(args.cwd)}</Tag>}
            {content.background && <Tag color="processing">{t('sandbox.background')}</Tag>}
            {content.commandId && <Tag>{content.commandId}</Tag>}
            {content.exitCode !== undefined && (
              <Tag color={content.exitCode === 0 ? 'success' : 'error'}>
                {t('sandbox.exitCode', { code: content.exitCode })}
              </Tag>
            )}
            {content.timedOut && <Tag color="warning">{t('sandbox.timedOut')}</Tag>}
          </Flexbox>
        )}
        {done && content && (
          <OutputBlock
            items={[
              { data: content.stdout ?? '', type: 'stdout' },
              { data: content.stderr ?? '', type: 'stderr' },
            ]}
          />
        )}
      </Flexbox>
    );
  },
);

const CommandOutputView = memo<{ args: SandboxArgs; content?: SandboxToolResult }>(
  ({ args, content }) => {
    const { t } = useTranslation('tool');
    const commandId = content?.commandId ?? text(args.commandId);

    return (
      <Flexbox gap={12}>
        <Flexbox gap={8} horizontal wrap="wrap">
          {commandId && <Tag>{commandId}</Tag>}
          {content?.running === true && <Tag color="processing">{t('sandbox.running')}</Tag>}
          {content?.running === false && <Tag>{t('sandbox.stopped')}</Tag>}
          {content?.exitCode !== undefined && (
            <Tag color={content.exitCode === 0 ? 'success' : 'error'}>
              {t('sandbox.exitCode', { code: content.exitCode })}
            </Tag>
          )}
        </Flexbox>
        {content?.log && (
          <OutputBlock items={[{ data: content.log, type: 'stdout' }]} title={t('sandbox.log')} />
        )}
      </Flexbox>
    );
  },
);

const FileView = memo<{
  apiName: string;
  args: SandboxArgs;
  content?: SandboxToolResult;
}>(({ apiName, args, content }) => {
  const { t } = useTranslation('tool');
  const path = content?.path ?? text(args.path);
  const language = languageForPath(path);

  return (
    <Flexbox gap={12}>
      <Flexbox align="center" gap={8} horizontal wrap="wrap">
        <Text code>{path}</Text>
        {content?.binary && <Tag>{t('sandbox.binaryFile', { size: content.size ?? 0 })}</Tag>}
        {content?.endLine !== undefined && content.totalLines !== undefined && (
          <Tag>
            {t('sandbox.lines', {
              end: content.endLine,
              start: content.startLine ?? 1,
              total: content.totalLines,
            })}
          </Tag>
        )}
        {content?.bytes !== undefined && (
          <Tag>{t('sandbox.bytesWritten', { bytes: content.bytes })}</Tag>
        )}
        {content?.replacements !== undefined && (
          <Tag>{t('sandbox.replacements', { count: content.replacements })}</Tag>
        )}
      </Flexbox>
      {apiName === SandboxApiName.readFile && content?.content && (
        <CodeView code={content.content} language={language} maxHeight={400} />
      )}
      {apiName === SandboxApiName.writeFile && text(args.content) && (
        <CodeView code={text(args.content)} language={language} maxHeight={400} />
      )}
      {apiName === SandboxApiName.editFile && (
        <Flexbox gap={8}>
          <CodeView code={text(args.oldString)} language={language} />
          <CodeView code={text(args.newString)} language={language} />
        </Flexbox>
      )}
    </Flexbox>
  );
});

const ListView = memo<{ args: SandboxArgs; content?: SandboxToolResult }>(({ args, content }) => {
  const { t } = useTranslation('tool');
  const entries = content?.entries ?? [];
  const root = content?.path ?? text(args.path);

  return (
    <Flexbox gap={8}>
      <Flexbox align="center" gap={8} horizontal>
        {root && <Text code>{root}</Text>}
        {content && <Tag>{t('sandbox.entries', { count: entries.length })}</Tag>}
        {content?.truncated && <Tag color="warning">{t('sandbox.truncated')}</Tag>}
      </Flexbox>
      {content && entries.length === 0 && !content.error && (
        <Text type="secondary">{t('sandbox.emptyDirectory')}</Text>
      )}
      {entries.length > 0 && (
        <CodeView
          code={entries
            .map((entry) => {
              const relative =
                root && entry.path.startsWith(`${root}/`)
                  ? entry.path.slice(root.length + 1)
                  : entry.path;
              return entry.type === 'directory' ? `${relative}/` : relative;
            })
            .join('\n')}
          language="text"
          maxHeight={300}
        />
      )}
    </Flexbox>
  );
});

const ExportView = memo<{ args: SandboxArgs; content?: SandboxToolResult }>(({ args, content }) => {
  const { t } = useTranslation('tool');
  const paths = Array.isArray(args.paths) ? args.paths.filter((item) => typeof item === 'string') : [];

  return (
    <Flexbox gap={12}>
      {paths.length > 0 && (
        <Flexbox gap={8} horizontal wrap="wrap">
          {paths.map((path) => (
            <Text code key={path}>
              {path}
            </Text>
          ))}
        </Flexbox>
      )}
      {content?.files && content.files.length > 0 && (
        <Flexbox>
          <Text strong style={{ marginBottom: 8 }}>
            {t('sandbox.exportedFiles')}
          </Text>
          <ResultFileGallery files={content.files} />
        </Flexbox>
      )}
      {content?.skipped && content.skipped.length > 0 && (
        <OutputBlock
          items={[{ data: content.skipped.join('\n'), type: 'stderr' }]}
          title={t('sandbox.skipped')}
        />
      )}
    </Flexbox>
  );
});

const Sandbox = memo<BuiltinRenderProps<SandboxToolResult, SandboxArgs, SandboxToolState>>(
  ({ content, args, pluginState, messageId, apiName }) => {
    const { t } = useTranslation('tool');
    const isExecuting = useChatStore(chatToolSelectors.isSandboxExecuting(messageId));
    const api = resolveSandboxApiName(apiName ?? '');
    const safeArgs = args ?? {};
    const done = !isExecuting;

    const error = pluginState?.error ?? (content?.success === false ? content.error : undefined);
    const errorText =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : error
            ? JSON.stringify(error, null, 2)
            : undefined;

    let body;
    switch (api) {
      case SandboxApiName.runPython: {
        body = <PythonView args={safeArgs} content={content} done={done} />;
        break;
      }
      case SandboxApiName.runCommand: {
        body = <CommandView args={safeArgs} content={content} done={done} />;
        break;
      }
      case SandboxApiName.getCommandOutput:
      case SandboxApiName.stopCommand: {
        body = <CommandOutputView args={safeArgs} content={content} />;
        break;
      }
      case SandboxApiName.readFile:
      case SandboxApiName.writeFile:
      case SandboxApiName.editFile: {
        body = <FileView apiName={api} args={safeArgs} content={content} />;
        break;
      }
      case SandboxApiName.listFiles: {
        body = <ListView args={safeArgs} content={content} />;
        break;
      }
      case SandboxApiName.exportFile: {
        body = <ExportView args={safeArgs} content={content} />;
        break;
      }
      default: {
        body = <CodeView code={JSON.stringify(safeArgs, null, 2)} language="json" />;
      }
    }

    return (
      <Flexbox gap={12}>
        {body}
        {isExecuting && (
          <Flexbox gap={8} horizontal>
            <BubblesLoading />
            <Text type="secondary">{t('codeInterpreter.executing')}</Text>
          </Flexbox>
        )}
        {done && errorText && (
          <Alert description={errorText} message={t('codeInterpreter.error')} showIcon type="error" />
        )}
        {done && content?.hint && <Text type="secondary">{content.hint}</Text>}
      </Flexbox>
    );
  },
);

export default Sandbox;
