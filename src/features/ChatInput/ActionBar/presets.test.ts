import { describe, expect, it } from 'vitest';

import { GROUP_CHAT_LEFT_ACTIONS, MOBILE_CHAT_LEFT_ACTIONS } from './presets';

describe('chat input action presets', () => {
  it.each([
    ['mobile', MOBILE_CHAT_LEFT_ACTIONS],
    ['group chat', GROUP_CHAT_LEFT_ACTIONS],
  ])('shows the Skills action in the %s composer', (_, actions) => {
    expect(actions).toContain('skills');
  });
});
