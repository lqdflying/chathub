export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Bootstrap debug namespaces early so all const log = debug('...')
    // instances created after this point respect CHATHUB_DEBUG=1.
    const { bootstrapDebug } = await import('./libs/logger/bootstrap');
    bootstrapDebug();

    if (process.env.ENABLE_TELEMETRY) {
      await import('./instrumentation.node');
    }
  }
}
