export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonValueType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';

export type JsonTreeLabelType = 'index' | 'key' | 'root';

interface JsonTreeNodeBase {
  key: string;
  label: string;
  labelType: JsonTreeLabelType;
}

interface JsonTreeContainerNode extends JsonTreeNodeBase {
  childCount: number;
  children: JsonTreeNode[];
  type: 'array' | 'object';
}

interface JsonTreeBooleanNode extends JsonTreeNodeBase {
  type: 'boolean';
  value: boolean;
}

interface JsonTreeNullNode extends JsonTreeNodeBase {
  type: 'null';
  value: null;
}

interface JsonTreeNumberNode extends JsonTreeNodeBase {
  type: 'number';
  value: number;
}

interface JsonTreeStringNode extends JsonTreeNodeBase {
  type: 'string';
  value: string;
}

export type JsonTreeNode =
  | JsonTreeBooleanNode
  | JsonTreeContainerNode
  | JsonTreeNullNode
  | JsonTreeNumberNode
  | JsonTreeStringNode;

export interface JsonTreeData {
  initialExpandedKeys: string[];
  root: JsonTreeNode;
}

export type JsonTreeBuildResult =
  | {
      data: JsonTreeData;
      exceededLimit: false;
    }
  | {
      exceededLimit: true;
    };

export type JsonParseResult =
  | {
      parsed: true;
      value: JsonValue;
    }
  | {
      parsed: false;
    };

const ROOT_KEY = '$';
const ROOT_LABEL = '$';

const escapeJsonPointerSegment = (segment: string): string =>
  segment.replaceAll('~', '~0').replaceAll('/', '~1');

const isContainer = (value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } =>
  Array.isArray(value) || (typeof value === 'object' && value !== null);

const getEntries = (
  value: JsonValue[] | { [key: string]: JsonValue },
): Array<[string, JsonValue]> =>
  Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);

const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
};

export const parseJsonValue = (text: string): JsonParseResult => {
  if (!text) return { parsed: false };

  try {
    const value: unknown = JSON.parse(text);
    return isJsonValue(value) ? { parsed: true, value } : { parsed: false };
  } catch {
    return { parsed: false };
  }
};

export const buildJsonTree = (value: JsonValue, nodeLimit: number): JsonTreeBuildResult => {
  if (nodeLimit < 1) return { exceededLimit: true };

  let nodeCount = 0;
  const initialExpandedKeys = new Set<string>();

  const buildNode = (
    currentValue: JsonValue,
    label: string,
    labelType: JsonTreeLabelType,
    key: string,
    depth: number,
  ): JsonTreeNode | undefined => {
    nodeCount += 1;
    if (nodeCount > nodeLimit) return;

    if (!isContainer(currentValue)) {
      if (currentValue === null) return { key, label, labelType, type: 'null', value: null };
      if (typeof currentValue === 'boolean') {
        return { key, label, labelType, type: 'boolean', value: currentValue };
      }
      if (typeof currentValue === 'number') {
        return { key, label, labelType, type: 'number', value: currentValue };
      }
      return { key, label, labelType, type: 'string', value: currentValue };
    }

    const entries = getEntries(currentValue);
    const children: JsonTreeNode[] = [];
    const childLabelType: JsonTreeLabelType = Array.isArray(currentValue) ? 'index' : 'key';

    for (const [childLabel, childValue] of entries) {
      const childKey = `${key}/${escapeJsonPointerSegment(childLabel)}`;
      const childNode = buildNode(childValue, childLabel, childLabelType, childKey, depth + 1);
      if (!childNode) return;
      children.push(childNode);
    }

    if (depth <= 1 && children.length > 0) initialExpandedKeys.add(key);

    return {
      childCount: entries.length,
      children,
      key,
      label,
      labelType,
      type: Array.isArray(currentValue) ? 'array' : 'object',
    };
  };

  const root = buildNode(value, ROOT_LABEL, 'root', ROOT_KEY, 0);
  if (!root) return { exceededLimit: true };

  return {
    data: {
      initialExpandedKeys: [...initialExpandedKeys],
      root,
    },
    exceededLimit: false,
  };
};
