import { Dropdown, DropdownMenuItemType, Icon } from '@lobehub/ui';
import { Button } from 'antd';
import { ArrowDownWideNarrow, ChevronDown } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useQuery } from '@/hooks/useQuery';
import { useQueryRoute } from '@/hooks/useQueryRoute';
import {
  DiscoverTab,
  McpSorts,
  PluginSorts,
} from '@/types/discover';

const SortButton = memo(() => {
  const { t } = useTranslation('discover');
  const pathname = usePathname();
  const { sort } = useQuery();
  const router = useQueryRoute();
  const activeTab = useMemo(() => pathname.split('discover/')[1] as DiscoverTab, [pathname]);
  const items = useMemo(() => {
    switch (activeTab) {
      case DiscoverTab.Mcp: {
        return [
          {
            key: McpSorts.IsFeatured,
            label: t('mcp.sorts.isFeatured'),
          },
          {
            key: McpSorts.IsValidated,
            label: t('mcp.sorts.isValidated'),
          },
          {
            key: McpSorts.InstallCount,
            label: t('mcp.sorts.installCount'),
          },
          {
            key: McpSorts.RatingCount,
            label: t('mcp.sorts.ratingCount'),
          },
          {
            key: McpSorts.UpdatedAt,
            label: t('mcp.sorts.updatedAt'),
          },
          {
            label: t('mcp.sorts.createdAt'),
            value: McpSorts.CreatedAt,
          },
        ];
      }
      case DiscoverTab.Plugins: {
        return [
          {
            key: PluginSorts.CreatedAt,
            label: t('plugins.sorts.createdAt'),
          },
          {
            key: PluginSorts.Title,
            label: t('plugins.sorts.title'),
          },
          {
            key: PluginSorts.Identifier,
            label: t('plugins.sorts.identifier'),
          },
        ];
      }
      default: {
        return [];
      }
    }
  }, [t, activeTab]);

  const activeItem: any = useMemo(() => {
    if (sort) {
      const findItem = items?.find((item: any) => item.key === sort);
      if (findItem) return findItem;
    }
    return items?.[0];
  }, [items, sort]);

  const handleSort = (config: string) => {
    router.push(pathname, {
      query: {
        sort: config,
      },
    });
  };

  if (items?.length === 0) return null;

  return (
    <Dropdown
      menu={{
        // @ts-expect-error 等待 antd 修复
        activeKey: activeItem.key,
        items: items as DropdownMenuItemType[],
        onClick: ({ key }) => handleSort(key),
      }}
      trigger={['click', 'hover']}
    >
      <Button icon={<Icon icon={ArrowDownWideNarrow} />} type={'text'}>
        {activeItem.label}
        <Icon icon={ChevronDown} />
      </Button>
    </Dropdown>
  );
});

export default SortButton;
