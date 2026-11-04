import { BuiltinToolManifest, SandboxProfileItem } from '@lobechat/types';

import { SandboxApiName, SandboxIdentifier } from './const';
import { systemRole } from './systemRole';

export * from './const';

const path = (description: string) => ({ description, type: 'string' });

const timeout = {
  description:
    'Time limit in seconds for this call. Omit to use the operator default. Values above the operator maximum are lowered to it.',
  type: 'number',
};

/** Shared by every Sandbox Hub profile; only identifier, meta and instruction differ. */
export const SANDBOX_API: BuiltinToolManifest['api'] = [
  {
    description:
      'Run a bash command line in the sandbox and return its stdout, stderr, and exit code. Use it for git, npm, pip, builds, tests, searches (rg, find), and any other shell work. Set background to true for servers and other long-running processes; the call then returns a commandId at once.',
    name: SandboxApiName.runCommand,
    parameters: {
      properties: {
        background: {
          description:
            'Start the command detached and return its commandId. Read output with getCommandOutput and end it with stopCommand.',
          type: 'boolean',
        },
        command: { description: 'The bash command line to run.', type: 'string' },
        cwd: path('Working directory. Defaults to the sandbox working directory.'),
        timeout,
      },
      required: ['command'],
      type: 'object',
    },
  },
  {
    description:
      'Read the status and new output (stdout and stderr combined) of a background command.',
    name: SandboxApiName.getCommandOutput,
    parameters: {
      properties: {
        commandId: { description: 'The commandId runCommand returned.', type: 'string' },
        cursor: {
          description:
            'The nextCursor from the previous getCommandOutput call, to read only newer output. Omit to read from the start.',
          type: 'number',
        },
      },
      required: ['commandId'],
      type: 'object',
    },
  },
  {
    description: 'Stop a background command and its child processes.',
    name: SandboxApiName.stopCommand,
    parameters: {
      properties: {
        commandId: { description: 'The commandId runCommand returned.', type: 'string' },
      },
      required: ['commandId'],
      type: 'object',
    },
  },
  {
    description:
      'Start a long task as a background job that keeps running after this reply, up to the operator runtime limit (2 hours unless changed), and return its jobId at once. Use it for work longer than the per-call time limit, such as builds, training, or data processing. Its result is saved when it ends, even after the sandbox is removed; read it with getJobResult.',
    name: SandboxApiName.startJob,
    parameters: {
      properties: {
        command: { description: 'The bash command line to run.', type: 'string' },
        cwd: path('Working directory. Defaults to the sandbox working directory.'),
        maxRuntimeMinutes: {
          description:
            'Stop the job after this many minutes. Omit for the operator limit; larger values are lowered to it.',
          type: 'number',
        },
        outputDir: path(
          'Folder whose files are kept and shared in the chat when the job ends. Write the results there. Created if missing.',
        ),
      },
      required: ['command'],
      type: 'object',
    },
  },
  {
    description:
      "Get a background job's status, exit code, output (start and end), and links to the files kept from its output folder. Works after the job ended and its sandbox was removed. While it runs, shows the output so far.",
    name: SandboxApiName.getJobResult,
    parameters: {
      properties: {
        jobId: { description: 'The jobId startJob returned.', type: 'string' },
      },
      required: ['jobId'],
      type: 'object',
    },
  },
  {
    description:
      'List the background jobs started in this conversation with this sandbox, newest first, with their status.',
    name: SandboxApiName.listJobs,
    parameters: { properties: {}, type: 'object' },
  },
  {
    description: 'Stop a running background job. The output and files it produced so far are kept.',
    name: SandboxApiName.cancelJob,
    parameters: {
      properties: {
        jobId: { description: 'The jobId startJob returned.', type: 'string' },
      },
      required: ['jobId'],
      type: 'object',
    },
  },
  {
    description:
      'Run Python code in a new process. New or changed files in the working directory are returned as downloadable files: top-level files first, then files in subdirectories when they all fit in the per-call file limit.',
    name: SandboxApiName.runPython,
    parameters: {
      properties: {
        code: { description: 'The Python code to run.', type: 'string' },
        packages: {
          description:
            'PyPI package names the code imports. This argument does not install them. Prefer packages already in the sandbox; install missing ones with pip.',
          items: { type: 'string' },
          type: 'array',
        },
        timeout,
      },
      required: ['code'],
      type: 'object',
    },
  },
  {
    description:
      'Read a text file and return it with line numbers. Large files return up to limit lines from offset; read further with a larger offset.',
    name: SandboxApiName.readFile,
    parameters: {
      properties: {
        limit: { description: 'Lines to return. Default 2000.', type: 'number' },
        offset: { description: 'First line to return, starting at 1.', type: 'number' },
        path: path('File path, absolute or relative to the working directory.'),
      },
      required: ['path'],
      type: 'object',
    },
  },
  {
    description:
      'Create or replace a whole text file. Parent directories are created. An existing file keeps its permissions.',
    name: SandboxApiName.writeFile,
    parameters: {
      properties: {
        content: { description: 'The complete new file content.', type: 'string' },
        path: path('File path, absolute or relative to the working directory.'),
      },
      required: ['path', 'content'],
      type: 'object',
    },
  },
  {
    description:
      'Replace an exact string in a text file. oldString must appear exactly once, including whitespace and indentation, unless replaceAll is true.',
    name: SandboxApiName.editFile,
    parameters: {
      properties: {
        newString: { description: 'The replacement text.', type: 'string' },
        oldString: { description: 'The exact text to replace.', type: 'string' },
        path: path('File path, absolute or relative to the working directory.'),
        replaceAll: { description: 'Replace every occurrence.', type: 'boolean' },
      },
      required: ['path', 'oldString', 'newString'],
      type: 'object',
    },
  },
  {
    description: 'List the files and directories under a directory.',
    name: SandboxApiName.listFiles,
    parameters: {
      properties: {
        depth: { description: 'How many levels to descend, 1 to 5. Default 2.', type: 'number' },
        path: path('Directory to list. Defaults to the working directory.'),
      },
      type: 'object',
    },
  },
  {
    description:
      'Copy one or more files from the sandbox to the chat so the user can open or download them. Pass every file in one call. Returns a url for each file.',
    name: SandboxApiName.exportFile,
    parameters: {
      properties: {
        paths: {
          description:
            'File paths as a JSON array, absolute or relative to the working directory, for example ["report.pdf", "out/chart.png"]. One call exports up to the operator file limit (20 unless changed); paths over it come back in skipped.',
          items: { type: 'string' },
          type: 'array',
        },
      },
      required: ['paths'],
      type: 'object',
    },
  },
];

/** Title, description and avatar of the built-in `general` profile. */
export const SANDBOX_DEFAULT_META = {
  avatar:
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIiBmaWxsPSJub25lIj48cmVjdCB4PSIyIiB5PSI0IiB3aWR0aD0iMjgiIGhlaWdodD0iMjQiIHJ4PSI1IiBmaWxsPSIjMUYyOTM3Ii8+PHBhdGggZD0iTTIgOWE1IDUgMCAwIDEgNS01aDE4YTUgNSAwIDAgMSA1IDV2MUgyVjlaIiBmaWxsPSIjMzc0MTUxIi8+PGNpcmNsZSBjeD0iNi41IiBjeT0iNyIgcj0iMS4yIiBmaWxsPSIjRjg3MTcxIi8+PGNpcmNsZSBjeD0iMTAiIGN5PSI3IiByPSIxLjIiIGZpbGw9IiNGQkJGMjQiLz48Y2lyY2xlIGN4PSIxMy41IiBjeT0iNyIgcj0iMS4yIiBmaWxsPSIjMzREMzk5Ii8+PHBhdGggZD0iTTggMTVsNSA0LTUgNCIgc3Ryb2tlPSIjMzREMzk5IiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PHBhdGggZD0iTTE1LjUgMjNoOCIgc3Ryb2tlPSIjRTVFN0VCIiBzdHJva2Utd2lkdGg9IjIuMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+Cg==',
  description: 'Run commands, code, git, and Node.js in a Linux sandbox, and work with its files',
  title: 'Sandbox',
};

export interface SandboxManifestInput {
  avatar?: string;
  description: string;
  identifier: string;
  systemRole: string;
  title: string;
}

/** One Sandbox tool manifest per Sandbox Hub profile, with the shared APIs. */
export const createSandboxManifest = ({
  avatar,
  description,
  identifier,
  systemRole: instruction,
  title,
}: SandboxManifestInput): BuiltinToolManifest => ({
  api: SANDBOX_API,
  identifier,
  meta: { avatar: avatar ?? SANDBOX_DEFAULT_META.avatar, description, title },
  systemRole: instruction,
  type: 'builtin',
});

export const SandboxManifest: BuiltinToolManifest = createSandboxManifest({
  ...SANDBOX_DEFAULT_META,
  identifier: SandboxIdentifier,
  systemRole,
});

/**
 * The tool a Sandbox Hub profile puts in front of the model. Its systemRole
 * is that profile's composed instruction, not `SandboxManifest.systemRole`.
 */
export const createSandboxProfileManifest = (
  profile: Pick<
    SandboxProfileItem,
    'avatar' | 'description' | 'identifier' | 'instruction' | 'name'
  >,
) =>
  createSandboxManifest({
    avatar: profile.avatar,
    description: profile.description,
    identifier: profile.identifier,
    systemRole: profile.instruction,
    title: profile.name,
  });
