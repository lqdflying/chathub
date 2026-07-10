'use client';

import { Tree, type TreeDataNode } from 'antd';
import { createStyles } from 'antd-style';
import { type ReactNode, memo, useCallback, useEffect, useMemo, useState } from 'react';

import type { JsonPrimitive, JsonTreeData, JsonTreeNode } from './jsonTree';

const TREE_HEIGHT = 400;

const useStyles = createStyles(({ css, token }) => ({
  booleanValue: css`
    color: ${token.colorWarningText};
  `,
  container: css`
    overflow: hidden;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorFillTertiary};
  `,
  containerValue: css`
    color: ${token.colorTextSecondary};
  `,
  key: css`
    flex: none;
    color: ${token.colorText};
  `,
  node: css`
    display: flex;
    align-items: center;
    overflow: hidden;
    gap: 6px;
    min-width: 0;
    height: 24px;

    font-family: ${token.fontFamilyCode};
    font-size: 13px;
    line-height: 24px;
  `,
  nullValue: css`
    color: ${token.colorTextTertiary};
  `,
  numberValue: css`
    color: ${token.colorInfoText};
  `,
  stringValue: css`
    color: ${token.colorSuccessText};
  `,
  value: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

interface JsonTreeProps {
  accessibleLabel: string;
  data: JsonTreeData;
}

const formatLabel = (node: JsonTreeNode): string =>
  node.labelType === 'index' ? `[${node.label}]` : node.label;

const formatPrimitive = (value: JsonPrimitive): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
};

const JsonTree = memo<JsonTreeProps>(({ accessibleLabel, data }) => {
  const { styles } = useStyles();
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(data.initialExpandedKeys);

  useEffect(() => {
    setExpandedKeys(data.initialExpandedKeys);
  }, [data]);

  const renderNodeTitle = useCallback(
    (node: JsonTreeNode): ReactNode => {
      const label = formatLabel(node);
      const hasLabelSeparator = node.labelType !== 'root';

      let value: string;
      let valueClassName: string;

      switch (node.type) {
        case 'array': {
          value = `[${node.childCount}]`;
          valueClassName = styles.containerValue;
          break;
        }
        case 'boolean': {
          value = formatPrimitive(node.value);
          valueClassName = styles.booleanValue;
          break;
        }
        case 'null': {
          value = 'null';
          valueClassName = styles.nullValue;
          break;
        }
        case 'number': {
          value = formatPrimitive(node.value);
          valueClassName = styles.numberValue;
          break;
        }
        case 'object': {
          value = `{${node.childCount}}`;
          valueClassName = styles.containerValue;
          break;
        }
        case 'string': {
          value = formatPrimitive(node.value);
          valueClassName = styles.stringValue;
          break;
        }
      }

      return (
        <span className={styles.node}>
          <span className={styles.key}>{hasLabelSeparator ? `${label}:` : label}</span>
          <span className={`${styles.value} ${valueClassName}`} title={value}>
            {value}
          </span>
        </span>
      );
    },
    [styles],
  );

  const treeData = useMemo(() => {
    const convertNode = (node: JsonTreeNode): TreeDataNode => ({
      children:
        node.type === 'array' || node.type === 'object'
          ? node.children.map(convertNode)
          : undefined,
      key: node.key,
      title: renderNodeTitle(node),
    });

    return [convertNode(data.root)];
  }, [data, renderNodeTitle]);

  return (
    <div className={styles.container}>
      <Tree
        aria-label={accessibleLabel}
        blockNode
        expandedKeys={expandedKeys}
        height={TREE_HEIGHT}
        onExpand={setExpandedKeys}
        selectable={false}
        treeData={treeData}
        virtual
      />
    </div>
  );
});

JsonTree.displayName = 'JsonTree';

export default JsonTree;
