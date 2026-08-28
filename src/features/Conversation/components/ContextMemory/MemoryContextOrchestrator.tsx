'use client';

import { memo } from 'react';

import ContextAutoCompactWatcher from './ContextAutoCompactWatcher';

const MemoryContextOrchestrator = memo(() => (
  <ContextAutoCompactWatcher />
));

MemoryContextOrchestrator.displayName = 'MemoryContextOrchestrator';

export default MemoryContextOrchestrator;
