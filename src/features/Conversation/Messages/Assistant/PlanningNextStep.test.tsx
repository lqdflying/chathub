import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLANNING_NEXT_STEP_SLOW_MS } from '@/store/chat/slices/aiChat/selectors';

import PlanningNextStep from './PlanningNextStep';

vi.stubGlobal('React', React);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/CircleLoader', () => ({
  default: () => <div data-testid="circle-loader" />,
}));

describe('PlanningNextStep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to still-working copy after 20s', () => {
    render(<PlanningNextStep phaseEnteredAt={new Date(Date.now() - 1000).toISOString()} />);
    expect(screen.getByText('planningNextStep.title')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(PLANNING_NEXT_STEP_SLOW_MS);
    });

    expect(screen.getByText('planningNextStep.slow')).toBeTruthy();
    expect(screen.getByTestId('circle-loader')).toBeTruthy();
  });

  it('renders still-working copy immediately when the phase clock is already past 20s', () => {
    render(
      <PlanningNextStep
        phaseEnteredAt={new Date(Date.now() - PLANNING_NEXT_STEP_SLOW_MS - 1000).toISOString()}
      />,
    );

    expect(screen.getByText('planningNextStep.slow')).toBeTruthy();
  });
});
