import type { RuntimeConfig } from '../types';

const TOOLS_DEBUG_NAMESPACE = 'chathub-tools-debug';

const isEnvironmentReporterEnabled = (): boolean => {
  if (typeof process === 'undefined') return false;

  const configuredValue = process.env.CHATHUB_TOOLS_DEBUG?.trim().toLowerCase();
  return ['1', '2', 'on', 'safe', 'true', 'verbose'].includes(configuredValue || '');
};

const writeDiagnosticEvent = (event: string, fields: Record<string, unknown>): void => {
  if (!isEnvironmentReporterEnabled()) return;

  try {
    console.log(
      `[${TOOLS_DEBUG_NAMESPACE}:${event}]`,
      JSON.stringify({
        debugLevel: 'safe',
        runtimeType: 'server',
        schemaVersion: 2,
        ...fields,
      }),
    );
  } catch {
    // Diagnostics must never affect agent execution.
  }
};

export const environmentToolDiagnostics: NonNullable<RuntimeConfig['toolDiagnostics']> = {
  isEnabled: isEnvironmentReporterEnabled,
  reportBatch: (correlation, phase) => {
    writeDiagnosticEvent(`tool_batch_${phase}`, {
      ...correlation,
      phase,
    });
  },
  reportCompletion: ({
    callIdHash,
    correlation,
    diagnosticId,
    outcome,
    result,
    runtimeType,
    toolNameHash,
  }) => {
    writeDiagnosticEvent('tool_completion_reported', {
      ...correlation,
      callIdHash,
      diagnosticId,
      outcome,
      result,
      runtimeType,
      toolNameHash,
    });
  },
};
