import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { AgentMemoryProvider } from '../AgentMemory';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages,
  metadata: { model: 'gpt-4', maxTokens: 4096 },
  isAborted: false,
});

describe('AgentMemoryProvider', () => {
  it('should skip injection when both tiers are empty', async () => {
    const provider = new AgentMemoryProvider({ dynamicMemory: '   ', fixedMemory: '' });

    const messages = [{ id: 'u1', role: 'user', content: 'Hello' }];
    const result = await provider.process(createContext(messages));

    expect(result.messages.find((msg) => msg.role === 'system')).toBeUndefined();
    expect(result.metadata.agentMemory).toBeUndefined();
  });

  it('should inject fixed memory only', async () => {
    const provider = new AgentMemoryProvider({ fixedMemory: 'User is allergic to peanuts.' });

    const result = await provider.process(
      createContext([{ id: 'u1', role: 'user', content: 'Hello' }]),
    );

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('<fixed_memory>');
    expect(systemMessage!.content).toContain('User is allergic to peanuts.');
    expect(systemMessage!.content).not.toContain('<dynamic_memory>');
    expect(result.metadata.agentMemory).toEqual({
      dynamicLength: 0,
      fixedLength: 'User is allergic to peanuts.'.length,
      injected: true,
    });
  });

  it('should inject dynamic memory only', async () => {
    const provider = new AgentMemoryProvider({ dynamicMemory: 'Working on project X.' });

    const result = await provider.process(
      createContext([{ id: 'u1', role: 'user', content: 'Hello' }]),
    );

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('<dynamic_memory>');
    expect(systemMessage!.content).toContain('Working on project X.');
    expect(systemMessage!.content).not.toContain('<fixed_memory>');
  });

  it('should inject both tiers with fixed memory first', async () => {
    const provider = new AgentMemoryProvider({
      dynamicMemory: 'dynamic notes',
      fixedMemory: 'fixed notes',
    });

    const result = await provider.process(
      createContext([{ id: 'u1', role: 'user', content: 'Hello' }]),
    );

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    const content = systemMessage!.content as string;
    expect(content.indexOf('<fixed_memory>')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('<fixed_memory>')).toBeLessThan(content.indexOf('<dynamic_memory>'));
  });

  it('should append to an existing system message', async () => {
    const provider = new AgentMemoryProvider({ fixedMemory: 'fixed notes' });

    const result = await provider.process(
      createContext([
        { id: 's1', role: 'system', content: 'You are a helpful assistant.' },
        { id: 'u1', role: 'user', content: 'Hello' },
      ]),
    );

    const systemMessages = result.messages.filter((msg) => msg.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain('You are a helpful assistant.');
    expect(systemMessages[0].content).toContain('fixed notes');
    expect(systemMessages[0].content.indexOf('You are a helpful assistant.')).toBeLessThan(
      systemMessages[0].content.indexOf('fixed notes'),
    );
  });

  it('should use the custom formatter when provided', async () => {
    const provider = new AgentMemoryProvider({
      dynamicMemory: 'dyn',
      fixedMemory: 'fix',
      formatAgentMemory: ({ dynamicMemory, fixedMemory }) =>
        `<assistant_memory>[${fixedMemory}|${dynamicMemory}]</assistant_memory>`,
    });

    const result = await provider.process(
      createContext([{ id: 'u1', role: 'user', content: 'Hello' }]),
    );

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toBe('<assistant_memory>[fix|dyn]</assistant_memory>');
  });
});
