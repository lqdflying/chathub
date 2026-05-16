export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Bootstrap logger early. CHATHUB_DEBUG=1 only affects Pino level;
    // debug() namespaces are not auto-enabled and must be set via DEBUG=... .
    const { bootstrapDebug } = await import('./libs/logger/bootstrap');
    bootstrapDebug();

    if (process.env.ENABLE_TELEMETRY) {
      await import('./instrumentation.node');
    }
  }
}
