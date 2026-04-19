'use client';

import { memo } from 'react';

import AssistantMemoryRollupScheduler from './AssistantMemoryRollupScheduler';
import ContextAutoCompactWatcher from './ContextAutoCompactWatcher';
import DailyMemorySummaryScheduler from './DailyMemorySummaryScheduler';

const MemoryContextOrchestrator = memo(() => (
  <>
    <ContextAutoCompactWatcher />
    <DailyMemorySummaryScheduler />
    <AssistantMemoryRollupScheduler />
  </>
));

MemoryContextOrchestrator.displayName = 'MemoryContextOrchestrator';

export default MemoryContextOrchestrator;
