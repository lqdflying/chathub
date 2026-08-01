'use client';

import { exportFile } from '@lobechat/utils/client';
import type {
  ContextExportAllocation,
  ContextExportJsonValue,
  ContextExportRequestSnapshot,
} from '@lobechat/types';
import { Highlighter, copyToClipboard } from '@lobehub/ui';
import { Alert, App, Button, Drawer, Empty, Segmented, Select, Tag } from 'antd';
import { createStyles } from 'antd-style';
import { Camera, Copy, Download, Eye, RotateCcw, X } from 'lucide-react';
import numeral from 'numeral';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatStore } from '@/store/chat';

const useStyles = createStyles(({ css, token }) => ({
  allocation: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px 16px;
  `,
  allocationItem: css`
    min-width: 0;
    padding-block: 4px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
  `,
  code: css`
    overflow: auto;
    flex: 1;
    min-height: 240px;
    max-height: calc(100vh - 330px);
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillQuaternary};
  `,
  drawerBody: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  `,
  label: css`
    overflow: hidden;
    color: ${token.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  metadata: css`
    flex-wrap: wrap;
  `,
  sectionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  value: css`
    font-family: ${token.fontFamilyCode};
    color: ${token.colorText};
  `,
}));

interface ContextExportControlProps {
  allocation: ContextExportAllocation;
}

type ContextLayer = 'engineered' | 'provider';

const stringifyJson = (value: ContextExportJsonValue | undefined): string =>
  JSON.stringify(value ?? null, null, 2);

const ContextExportControl = memo<ContextExportControlProps>(({ allocation }) => {
  const { styles } = useStyles();
  const { message } = App.useApp();
  const { t } = useTranslation('chat');
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [layer, setLayer] = useState<ContextLayer>('engineered');
  const [selectedRequestId, setSelectedRequestId] = useState<string>();

  const captureStatus = useChatStore((state) => state.contextExportCaptureStatus);
  const batch = useChatStore((state) => state.contextExportBatch);
  const armContextExport = useChatStore((state) => state.armContextExport);
  const cancelContextExport = useChatStore((state) => state.cancelContextExport);

  useEffect(() => {
    const requests = batch?.requests;
    if (!requests?.length) {
      setSelectedRequestId(undefined);
      return;
    }

    const selectedRequestStillExists = requests.some(
      (request) => request.requestId === selectedRequestId,
    );
    if (!selectedRequestStillExists) setSelectedRequestId(requests[0].requestId);
  }, [batch?.requests, selectedRequestId]);

  const selectedRequest = useMemo<ContextExportRequestSnapshot | undefined>(
    () => batch?.requests.find((request) => request.requestId === selectedRequestId),
    [batch?.requests, selectedRequestId],
  );

  const selectedContent = useMemo(
    () =>
      stringifyJson(
        layer === 'engineered'
          ? selectedRequest?.engineeredInput
          : selectedRequest?.providerRequest,
      ),
    [layer, selectedRequest?.engineeredInput, selectedRequest?.providerRequest],
  );

  const requestOptions = useMemo(
    () =>
      batch?.requests.map((request) => ({
        label: t('contextExport.requestOption', {
          continuation: t(`contextExport.continuation.${request.continuationReason}`),
          index: request.sequence + 1,
          model: request.metadata?.model || t('contextExport.unknownModel'),
          purpose: t(`contextExport.purpose.${request.purpose}`),
        }),
        value: request.requestId,
      })) || [],
    [batch?.requests, t],
  );

  const selectedAllocation = selectedRequest?.allocation;
  const allocationItems = useMemo(
    () =>
      selectedAllocation
        ? [
            {
              label: t('tokenDetails.chatInstruction'),
              value: selectedAllocation.chatInstruction,
            },
            { label: t('tokenDetails.roleSettings'), value: selectedAllocation.roleSettings },
            {
              label: t('tokenDetails.assistantMemory'),
              value: selectedAllocation.assistantMemory,
            },
            {
              label: t('tokenDetails.groupOrchestration'),
              value: selectedAllocation.groupOrchestration,
            },
            { label: t('tokenDetails.tools'), value: selectedAllocation.pluginSettings },
            {
              label: t('tokenDetails.historySummary'),
              value: selectedAllocation.historySummary,
            },
            { label: t('tokenDetails.supervisor'), value: selectedAllocation.supervisor },
            { label: t('tokenDetails.chats'), value: selectedAllocation.chatMessages },
            { label: t('tokenDetails.used'), value: selectedAllocation.total },
          ].filter((item): item is { label: string; value: number } => item.value !== undefined)
        : [],
    [selectedAllocation, t],
  );

  const handleArm = () => {
    armContextExport(allocation);
  };

  const handleCopy = async () => {
    await copyToClipboard(selectedContent);
    message.success(t('contextExport.copySuccess'));
  };

  const handleDownload = () => {
    if (!batch) return;
    exportFile(
      JSON.stringify(batch, null, 2),
      `chathub-context-${batch.captureId.slice(-8)}.json`,
    );
  };

  const renderControl = () => {
    if (captureStatus === 'armed') {
      return (
        <Button block icon={<X size={14} />} onClick={cancelContextExport} size={'small'}>
          {t('contextExport.cancelCapture')}
        </Button>
      );
    }

    if (captureStatus === 'capturing') {
      return (
        <Button block danger icon={<X size={14} />} onClick={cancelContextExport} size={'small'}>
          {t('contextExport.cancelCapture')}
        </Button>
      );
    }

    if (captureStatus === 'ready') {
      return (
        <Button
          block
          disabled={!batch}
          icon={<Eye size={14} />}
          onClick={() => setDrawerOpen(true)}
          size={'small'}
        >
          {t('contextExport.viewCaptured')}
        </Button>
      );
    }

    return (
      <Button block icon={<Camera size={14} />} onClick={handleArm} size={'small'}>
        {t('contextExport.exportNext')}
      </Button>
    );
  };

  return (
    <>
      {renderControl()}
      <Drawer
        destroyOnHidden
        footer={
          <Flexbox gap={8} horizontal={!isMobile}>
            <Button
              block={isMobile}
              disabled={!selectedRequest}
              icon={<Copy size={16} />}
              onClick={handleCopy}
            >
              {t('contextExport.copyLayer')}
            </Button>
            <Button
              block={isMobile}
              disabled={!batch}
              icon={<Download size={16} />}
              onClick={handleDownload}
              type={'primary'}
            >
              {t('contextExport.downloadBatch')}
            </Button>
            <Button
              block={isMobile}
              icon={<RotateCcw size={16} />}
              onClick={() => {
                handleArm();
                setDrawerOpen(false);
              }}
            >
              {t('contextExport.captureNext')}
            </Button>
          </Flexbox>
        }
        height={isMobile ? '92vh' : undefined}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        placement={isMobile ? 'bottom' : 'right'}
        styles={{ body: { overflow: 'hidden' } }}
        title={t('contextExport.title')}
        width={isMobile ? undefined : 760}
      >
        <Flexbox className={styles.drawerBody}>
          {batch?.status === 'partial' && (
            <Alert message={t('contextExport.partialWarning')} showIcon type={'warning'} />
          )}

          {requestOptions.length > 0 ? (
            <>
              <Flexbox gap={8}>
                <div className={styles.sectionTitle}>{t('contextExport.request')}</div>
                <Select
                  onChange={setSelectedRequestId}
                  options={requestOptions}
                  value={selectedRequestId}
                />
              </Flexbox>

              {selectedRequest && (
                <Flexbox className={styles.metadata} gap={6} horizontal>
                  <Tag>{t(`contextExport.status.${selectedRequest.status}`)}</Tag>
                  {selectedRequest.metadata?.provider && (
                    <Tag>{selectedRequest.metadata.provider}</Tag>
                  )}
                  {selectedRequest.metadata?.model && <Tag>{selectedRequest.metadata.model}</Tag>}
                  {selectedRequest.metadata?.apiMode && (
                    <Tag>{selectedRequest.metadata.apiMode}</Tag>
                  )}
                  {selectedRequest.redactions.map((redaction) => (
                    <Tag key={redaction}>{redaction}</Tag>
                  ))}
                </Flexbox>
              )}

              {allocationItems.length > 0 && (
                <Flexbox gap={8}>
                  <div className={styles.sectionTitle}>{t('contextExport.allocation')}</div>
                  <div className={styles.allocation}>
                    {allocationItems.map((item) => (
                      <Flexbox
                        className={styles.allocationItem}
                        horizontal
                        justify={'space-between'}
                        key={item.label}
                      >
                        <span className={styles.label}>{item.label}</span>
                        <span className={styles.value}>{numeral(item.value).format('0,0')}</span>
                      </Flexbox>
                    ))}
                  </div>
                </Flexbox>
              )}

              <Segmented<ContextLayer>
                block
                onChange={setLayer}
                options={[
                  {
                    label: t('contextExport.engineeredContext'),
                    value: 'engineered',
                  },
                  {
                    label: t('contextExport.providerRequest'),
                    value: 'provider',
                  },
                ]}
                value={layer}
              />

              {layer === 'provider' && (
                <Alert message={t('contextExport.providerBoundary')} showIcon type={'info'} />
              )}

              <div className={styles.code}>
                <Highlighter language={'json'} variant={'borderless'} wrap>
                  {selectedContent}
                </Highlighter>
              </div>
            </>
          ) : (
            <Empty description={t('contextExport.noRequests')} />
          )}
        </Flexbox>
      </Drawer>
    </>
  );
});

ContextExportControl.displayName = 'ContextExportControl';

export default ContextExportControl;
