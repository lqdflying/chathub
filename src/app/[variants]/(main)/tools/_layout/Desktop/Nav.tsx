'use client';

import { memo } from 'react';

import Menu from '@/components/Menu';

import { useToolsNav } from '../useToolsNav';

const Nav = memo(() => {
  const { activeKey, items, navigateToTool } = useToolsNav();

  return (
    <Menu
      compact
      items={items}
      onClick={({ key }) => navigateToTool(key)}
      selectable
      selectedKeys={[activeKey]}
    />
  );
});

Nav.displayName = 'ToolsNav';

export default Nav;
