'use client';

import { memo } from 'react';

import ContextAutoCompactWatcher from './ContextAutoCompactWatcher';
import DailyMemorySummaryScheduler from './DailyMemorySummaryScheduler';

const MemoryContextOrchestrator = memo(() => (
  <>
    <ContextAutoCompactWatcher />
    <DailyMemorySummaryScheduler />
  </>
));

MemoryContextOrchestrator.displayName = 'MemoryContextOrchestrator';

export default MemoryContextOrchestrator;
