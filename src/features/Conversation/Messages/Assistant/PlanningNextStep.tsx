import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PLANNING_NEXT_STEP_SLOW_MS } from '@/store/chat/slices/aiChat/selectors';

import AssistantStatusRow from './AssistantStatusRow';

const PlanningNextStep = memo<{ phaseEnteredAt?: string }>(({ phaseEnteredAt }) => {
  const { t } = useTranslation('chat');
  const startedAtRef = useRef(phaseEnteredAt ? Date.parse(phaseEnteredAt) : Date.now());
  const [slow, setSlow] = useState(
    () => Date.now() - startedAtRef.current >= PLANNING_NEXT_STEP_SLOW_MS,
  );

  useEffect(() => {
    startedAtRef.current = phaseEnteredAt ? Date.parse(phaseEnteredAt) : Date.now();
    setSlow(Date.now() - startedAtRef.current >= PLANNING_NEXT_STEP_SLOW_MS);
  }, [phaseEnteredAt]);

  useEffect(() => {
    if (slow) return;
    const timer = window.setInterval(() => {
      if (Date.now() - startedAtRef.current >= PLANNING_NEXT_STEP_SLOW_MS) {
        setSlow(true);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [slow, phaseEnteredAt]);

  return (
    <AssistantStatusRow
      title={slow ? t('planningNextStep.slow') : t('planningNextStep.title')}
    />
  );
});

export default PlanningNextStep;
