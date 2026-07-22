import { ChatTopic, GroupedTopic, TimeGroupId } from '@lobechat/types';
import dayjs from 'dayjs';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';

// 初始化 dayjs 插件
dayjs.extend(isToday);
dayjs.extend(isYesterday);

const toTimestamp = (value: Date | number | string | undefined, fallback: number): number => {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();

  const parsedValue = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
};

export const normalizeTopic = (topic: ChatTopic): ChatTopic => {
  const createdAt = toTimestamp(topic.createdAt, Date.now());
  const updatedAt = toTimestamp(topic.updatedAt, createdAt);

  return {
    ...topic,
    createdAt,
    lastActivityAt: toTimestamp(topic.lastActivityAt, updatedAt),
    updatedAt,
  };
};

export const getTopicActivityTimestamp = (topic: ChatTopic): number =>
  topic.lastActivityAt ?? topic.updatedAt ?? topic.createdAt;

export const formatTopicRelativeTime = (
  timestamp: number,
  locale: string,
  now: number = Date.now(),
): string => {
  const differenceInSeconds = Math.round((timestamp - now) / 1000);
  const absoluteSeconds = Math.abs(differenceInSeconds);
  const units = [
    { divisor: 31_536_000, unit: 'year' as const },
    { divisor: 2_592_000, unit: 'month' as const },
    { divisor: 604_800, unit: 'week' as const },
    { divisor: 86_400, unit: 'day' as const },
    { divisor: 3600, unit: 'hour' as const },
    { divisor: 60, unit: 'minute' as const },
  ];
  const selectedUnit = units.find(({ divisor }) => absoluteSeconds >= divisor) ?? units.at(-1)!;

  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    Math.round(differenceInSeconds / selectedUnit.divisor),
    selectedUnit.unit,
  );
};

const getTopicGroupId = (timestamp: number): TimeGroupId => {
  const date = dayjs(timestamp);
  const now = dayjs();

  if (date.isToday()) {
    return 'today';
  }

  if (date.isYesterday()) {
    return 'yesterday';
  }

  // 7天内（不包括今天和昨天）
  const weekAgo = now.subtract(7, 'day');
  if (date.isAfter(weekAgo) && !date.isToday() && !date.isYesterday()) {
    return 'week';
  }

  // 当前月份（不包括前面已经分组的日期）
  // 使用原生的月份和年份比较
  if (date.month() === now.month() && date.year() === now.year()) {
    return 'month';
  }

  // 当年的其他月份
  if (date.year() === now.year()) {
    return `${date.year()}-${(date.month() + 1).toString().padStart(2, '0')}`;
  }

  // 更早的年份
  return `${date.year()}`;
};

// 确保分组的排序
const sortGroups = (groups: GroupedTopic[]): GroupedTopic[] => {
  const orderMap = new Map<string, number>();

  // 设置固定分组的顺序
  orderMap.set('today', 0);
  orderMap.set('yesterday', 1);
  orderMap.set('week', 2);
  orderMap.set('month', 3);

  return groups.sort((a, b) => {
    const orderA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;

    if (orderA !== Number.MAX_SAFE_INTEGER || orderB !== Number.MAX_SAFE_INTEGER) {
      return orderA - orderB;
    }

    // 对于年月格式和年份格式的分组，按时间倒序排序
    return b.id.localeCompare(a.id);
  });
};

// 时间分组的具体实现
export const groupTopicsByTime = (topics: ChatTopic[]): GroupedTopic[] => {
  if (!topics.length) return [];

  const sortedTopics = [...topics].sort(
    (firstTopic, secondTopic) =>
      getTopicActivityTimestamp(secondTopic) - getTopicActivityTimestamp(firstTopic),
  );
  const groupsMap = new Map<TimeGroupId, ChatTopic[]>();

  sortedTopics.forEach((topic) => {
    const groupId = getTopicGroupId(getTopicActivityTimestamp(topic));
    const existingGroup = groupsMap.get(groupId) || [];
    groupsMap.set(groupId, [...existingGroup, topic]);
  });

  const result = Array.from(groupsMap.entries()).map(([id, children]) => ({
    children,
    id,
  }));

  return sortGroups(result);
};
