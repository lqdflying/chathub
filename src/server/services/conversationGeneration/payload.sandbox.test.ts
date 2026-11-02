/** @vitest-environment node */
import { ToolNameResolver } from '@lobechat/context-engine';
import { pluginPrompts } from '@lobechat/prompts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SandboxProfileCatalog } from '@/server/services/sandbox/profiles/schema';
import { SandboxManifest } from '@/tools/sandbox';

const state = vi.hoisted(() => ({
  catalog: undefined as unknown as SandboxProfileCatalog,
  choices: new Map<string, boolean>(),
  instructions: new Map<string, { instruction: string; updatedAt: Date }>(),
}));

vi.mock('@/envs/llm', () => ({ getLLMConfig: () => ({}) }));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: class {
    query = async () => [];
  },
}));
vi.mock('@/database/models/skill', () => ({
  SkillModel: class {
    findById = async () => undefined;
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (url: string) => url;
  },
}));
vi.mock('@/database/models/sandboxProfile', () => ({
  SandboxProfileModel: class {
    list = async () => state.choices;
  },
}));
vi.mock('@/database/models/sandboxProfileInstruction', () => ({
  SandboxProfileInstructionModel: class {
    list = async () => state.instructions;
  },
}));
vi.mock('@/server/services/sandbox/profiles/hub', () => ({
  findSandboxProfile: async (_db: unknown, id: string) =>
    state.catalog.profiles.find((profile) => profile.id === id),
  getSandboxProfileCatalog: async () => state.catalog,
}));
vi.mock('@/server/services/sandbox/profiles/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/sandbox/profiles/load')>();
  return {
    ...actual,
    findSandboxServer: (id: string) => state.catalog.servers.find((server) => server.id === id),
    getSandboxFileCatalog: () => state.catalog,
    isSandboxProfileUsable: (profile: { serverId: string }) =>
      state.catalog.servers.find((server) => server.id === profile.serverId)?.status === 'ok',
  };
});

const { loadSandboxProfiles } = await vi.importActual<
  typeof import('@/server/services/sandbox/profiles/load')
>('@/server/services/sandbox/profiles/load');
const { buildConversationChatPayload } = await import('./payload');

const env = {
  OPENSANDBOX_API_KEY: 'k',
  OPENSANDBOX_CPU: '1',
  OPENSANDBOX_IMAGE: 'chathub-sandbox:2',
  OPENSANDBOX_MEMORY: '2Gi',
  OPENSANDBOX_READY_TIMEOUT: 60_000,
  OPENSANDBOX_SERVER_URL: 'http://opensandbox:8090',
  OPENSANDBOX_SESSION_IDLE_TIMEOUT: 1_800_000,
  OPENSANDBOX_SESSION_MAX_LIFETIME: 0,
};

const runtimeState = {
  enabledAiModels: [
    {
      abilities: { functionCall: true },
      contextWindowTokens: 128_000,
      id: 'gpt-4o',
      providerId: 'openai',
    },
  ],
  runtimeConfig: {},
} as any;

const build = (plugins: string[]) =>
  buildConversationChatPayload({
    config: {
      chatConfig: { enableAssistantMemory: false, searchMode: 'off' },
      model: 'gpt-4o',
      plugins,
      provider: 'openai',
      systemRole: 'Be brief.',
    } as any,
    db: {} as any,
    generalInstruction: '',
    messages: [{ content: 'Hello', id: 'u1', role: 'user' } as any],
    runtimeState,
    sessionId: 'sess-1',
    userId: 'user-1',
  });

const systemText = (result: Awaited<ReturnType<typeof build>>) =>
  result.payload.messages
    .filter((item) => item.role === 'system')
    .map((item) => String(item.content))
    .join('\n');

const toolNames = (result: Awaited<ReturnType<typeof build>>) =>
  (result.payload.tools ?? []).map((tool: any) => tool.function.name).sort();

/** The worker's tool block for the static SandboxManifest, as built before Sandbox Hub. */
const legacySandboxBlock = () => {
  const resolver = new ToolNameResolver();
  return pluginPrompts({
    tools: [
      {
        apis: (SandboxManifest.api || []).map((api) => ({
          desc: api.description,
          name: resolver.generate(SandboxManifest.identifier, api.name, SandboxManifest.type),
        })),
        identifier: SandboxManifest.identifier,
        name: SandboxManifest.identifier,
        systemRole: SandboxManifest.systemRole,
      },
    ],
  });
};

describe('buildConversationChatPayload with Sandbox Hub profiles', () => {
  beforeEach(() => {
    state.catalog = loadSandboxProfiles({ env });
    state.choices = new Map();
    state.instructions = new Map();
  });

  it('builds the same Sandbox tools and instruction bytes as the static manifest', async () => {
    const result = await build(['lobe-sandbox']);
    expect(systemText(result)).toContain(legacySandboxBlock());
    expect(toolNames(result)).toEqual(
      (SandboxManifest.api || []).map((api) => `lobe-sandbox____${api.name}____builtin`).sort(),
    );
  });

  it('sends an admin-edited instruction in place of the starting text', async () => {
    state.instructions = new Map([
      ['general', { instruction: 'Use the sandbox image v3.', updatedAt: new Date() }],
    ]);
    const text = systemText(await build(['lobe-sandbox']));
    expect(text).toContain('Use the sandbox image v3.');
    expect(text).not.toContain(SandboxManifest.systemRole);
  });

  it('drops the tool and its instruction when the profile is turned off in the Hub', async () => {
    state.choices = new Map([['general', false]]);
    const result = await build(['lobe-sandbox']);
    expect(toolNames(result)).toEqual([]);
    expect(systemText(result)).not.toContain('You have a Linux sandbox');
  });

  it('adds nothing for agents without a Sandbox tool and skips the Hub lookup', async () => {
    const result = await build([]);
    expect(toolNames(result)).toEqual([]);
    expect(systemText(result)).not.toContain('lobe-sandbox');
  });

  it('gives each enabled profile its own tools and instruction, in config order', async () => {
    state.catalog = loadSandboxProfiles({
      env: { ...env, SANDBOX_PROFILES_FILE: '/p.yaml' },
      readFile: () => `version: 1
profiles:
  - {id: general, name: Sandbox, description: General Linux sandbox}
  - id: data
    name: Data
    description: Python with the data stack
    defaultEnabled: true
    instruction: {base: none, text: Prefer polars.}
  - {id: web, name: Web, description: Node tooling}
`,
    });
    const result = await build(['lobe-sandbox', 'lobe-sandbox--data', 'lobe-sandbox--web']);
    const names = toolNames(result);

    expect(names).toContain('lobe-sandbox____runCommand____builtin');
    expect(names).toContain('lobe-sandbox--data____runCommand____builtin');
    // `web` is off by default, so it is not offered even though the agent lists it.
    expect(names.some((name) => name.startsWith('lobe-sandbox--web'))).toBe(false);
    expect(names.every((name) => name.length < 64)).toBe(true);

    const text = systemText(result);
    expect(text).toContain('Prefer polars.');
    expect(text.indexOf('name="lobe-sandbox"')).toBeLessThan(
      text.indexOf('name="lobe-sandbox--data"'),
    );
  });
});
