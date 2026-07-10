'use client';

import { AutoComplete, Button, Checkbox, Input, Tooltip } from 'antd';
import { createStyles } from 'antd-style';
import { Plus, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

interface KeyValueRow {
  enabled: boolean;
  id: string;
  key: string;
  value: string;
}

const useStyles = createStyles(({ css, token }) => ({
  input: css`
    flex: 1;
    font-family: ${token.fontFamilyCode};
    font-size: 13px;
  `,
  row: css`
    padding-block: 6px;
    padding-inline: 0;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    &:last-of-type {
      border-block-end: none;
    }
  `,
}));

interface KeyValueEditorProps {
  addLabel: string;
  keyOptions?: string[];
  keyPlaceholder: string;
  onChange: (rows: KeyValueRow[]) => void;
  onCreateRow: () => KeyValueRow;
  rows: KeyValueRow[];
  valuePlaceholder: string;
}

const KeyValueEditor = memo<KeyValueEditorProps>(
  ({ addLabel, keyOptions, keyPlaceholder, onChange, onCreateRow, rows, valuePlaceholder }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('tools');

    const updateRow = (id: string, patch: Partial<KeyValueRow>) => {
      onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    };

    return (
      <Flexbox gap={8} style={{ padding: '16px 0' }}>
        {rows.map((row) => (
          <Flexbox align={'center'} className={styles.row} gap={8} horizontal key={row.id}>
            <Tooltip title={row.enabled ? t('apitest.disableRow') : t('apitest.enableRow')}>
              <Checkbox
                checked={row.enabled}
                onChange={(e) => updateRow(row.id, { enabled: e.target.checked })}
              />
            </Tooltip>
            {keyOptions ? (
              <AutoComplete
                className={styles.input}
                filterOption={(input, option) =>
                  String(option?.value ?? '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
                onChange={(value) => updateRow(row.id, { key: value })}
                options={keyOptions.map((name) => ({ value: name }))}
                placeholder={keyPlaceholder}
                value={row.key}
              />
            ) : (
              <Input
                className={styles.input}
                onChange={(e) => updateRow(row.id, { key: e.target.value })}
                placeholder={keyPlaceholder}
                value={row.key}
              />
            )}
            <Input
              className={styles.input}
              onChange={(e) => updateRow(row.id, { value: e.target.value })}
              placeholder={valuePlaceholder}
              value={row.value}
            />
            <Tooltip title={t('apitest.remove')}>
              <Button
                danger
                icon={<Trash2 size={14} />}
                onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                size={'small'}
                type={'text'}
              />
            </Tooltip>
          </Flexbox>
        ))}
        <Button
          icon={<Plus size={14} />}
          onClick={() => onChange([...rows, onCreateRow()])}
          size={'small'}
          style={{ alignSelf: 'flex-start' }}
          type={'dashed'}
        >
          {addLabel}
        </Button>
      </Flexbox>
    );
  },
);

KeyValueEditor.displayName = 'KeyValueEditor';

export default KeyValueEditor;
