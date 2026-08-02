import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { SkillInstructionsProvider } from '../SkillInstructions';

const createContext = (): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages: [{ id: 'user-1', role: 'user', content: 'Summarize this.' }],
  metadata: { model: 'gpt-4', maxTokens: 4096 },
  isAborted: false,
});

describe('SkillInstructionsProvider', () => {
  it('accepts an omitted config for non-chat context pipelines', async () => {
    const result = await new SkillInstructionsProvider(undefined).process(createContext());

    expect(result.messages).toEqual(createContext().messages);
    expect(result.metadata.skills).toBeUndefined();
  });

  it('injects metadata for available skills without their instructions', async () => {
    const result = await new SkillInstructionsProvider({
      activated: [],
      available: [
        {
          description: 'Summarize text.',
          identifier: 'summarize-text',
          name: 'summarize-text',
          instructions: 'secret body that must stay lazy',
        },
      ],
    }).process(createContext());

    const content = String(result.messages.find((message) => message.role === 'system')?.content);
    expect(content).toContain('summarize-text: Summarize text.');
    expect(content).not.toContain('secret body that must stay lazy');
    expect(result.metadata.skills).toEqual({ activated: [], available: ['summarize-text'] });
  });

  it('injects full instructions only for activated skills', async () => {
    const result = await new SkillInstructionsProvider({
      activated: [
        {
          description: 'Summarize text.',
          identifier: 'summarize-text',
          name: 'summarize-text',
          instructions: 'secret body',
        },
      ],
      available: [],
    }).process(createContext());

    const content = String(result.messages.find((message) => message.role === 'system')?.content);
    expect(content).toContain('<activated_skills>');
    expect(content).toContain('secret body');
  });
});
