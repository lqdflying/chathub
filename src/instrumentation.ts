export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Bootstrap logger early. CHATHUB_DEBUG=1 only affects Pino level;
    // CHATHUB_TOOLS_DEBUG is handled by its structured logger, while debug()
    // namespaces remain explicit DEBUG=... opt-ins.
    const { bootstrapDebug } = await import('./libs/logger/bootstrap');
    bootstrapDebug();

    if (process.env.ENABLE_TELEMETRY) {
      await import('./instrumentation.node');
    }

    const { startConversationGenerationSweeper, startConversationGenerationWorker } =
      await import('./server/services/conversationGeneration/worker');
    startConversationGenerationSweeper();
    try {
      await startConversationGenerationWorker();
    } catch (error) {
      console.error('[conversation-generation] failed to bootstrap worker', error);
    }
  }
}
