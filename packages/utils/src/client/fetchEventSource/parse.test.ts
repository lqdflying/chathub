import { describe, expect, it, vi } from 'vitest';

import { getLines, getMessages } from './parse';

describe('fetchEventSource parser', () => {
  it('ignores comment-only heartbeat frames', () => {
    const onMessage = vi.fn();
    const onChunk = getLines(getMessages(vi.fn(), onMessage));

    onChunk(
      new TextEncoder().encode(': chathub-ping\n\nid: message-1\nevent: text\ndata: "hello"\n\n'),
    );

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      data: '"hello"',
      event: 'text',
      id: 'message-1',
      retry: undefined,
    });
  });

  it('does not dispatch an id-only frame', () => {
    const onMessage = vi.fn();
    const onId = vi.fn();
    const onChunk = getLines(getMessages(onId, onMessage));

    onChunk(new TextEncoder().encode('id: checkpoint\n\n'));

    expect(onId).toHaveBeenCalledWith('checkpoint');
    expect(onMessage).not.toHaveBeenCalled();
  });
});
