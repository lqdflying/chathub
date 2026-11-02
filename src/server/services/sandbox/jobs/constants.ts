export const SANDBOX_JOB_WATCH_TASK = 'sandbox_job_watch';

/** How often the watcher checks a running job (and renews its sandbox). */
export const SANDBOX_JOB_POLL_MS = 60_000;

/** A job whose sandbox server cannot be reached for this long is given up as lost. */
export const SANDBOX_JOB_UNREACHABLE_MS = 10 * 60_000;

/** Renewal budget of one check; covers reading the output and kept files. */
export const SANDBOX_JOB_CHECK_BUDGET_MS = 120_000;

/** Stored command text; longer commands are cut. */
export const SANDBOX_JOB_COMMAND_MAX_CHARS = 4096;

/** Graphile attempts for one watch run before it gives up (a later poll is not queued then). */
export const SANDBOX_JOB_WATCH_MAX_ATTEMPTS = 10;

/** Jobs `listJobs` and the Hub show. */
export const SANDBOX_JOB_LIST_LIMIT = 20;
