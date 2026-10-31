export type ProviderUsageStatus = 'authError' | 'error' | 'noCredential' | 'ok' | 'unavailable';

export type ProviderUsageCredentialSource = 'server' | 'user';

export type ProviderUsageCredentialType = 'admin' | 'apiKey';

export type ProviderUsageBalance = {
  currency: string;
  /** Granted / voucher credit included in `total`. */
  granted?: number;
  /** Topped-up / cash credit included in `total`. May be negative (debt). */
  paid?: number;
  total: number;
};

export type ProviderUsageWindowKind = 'custom' | 'daily' | 'fiveHour' | 'monthly' | 'weekly';

export type ProviderUsageWindowUnit = 'calls' | 'tokens';

export type ProviderUsageWindow = {
  kind: ProviderUsageWindowKind;
  /** Short vendor label used to tell apart several windows of one kind. */
  label?: string;
  limit?: number;
  remaining?: number;
  remainingPercent?: number;
  resetsAt?: string;
  unit?: ProviderUsageWindowUnit;
  used?: number;
  usedPercent?: number;
  windowMinutes?: number;
};

export type ProviderUsageSpend = {
  amount: number;
  currency: string;
  /** ISO start of the reported period (UTC month start). */
  since: string;
};

/** Machine-readable hint for the UI; never a vendor message. */
export type ProviderUsageReason = 'notOnPlan' | 'teamIdRequired';

export type ProviderUsageStoredCredential = {
  keyHint: string;
  teamId?: string;
};

export type ProviderUsageSnapshot = {
  balances?: ProviderUsageBalance[];
  credentialSource?: ProviderUsageCredentialSource;
  credentialType: ProviderUsageCredentialType;
  fetchedAt: string;
  isAvailable?: boolean;
  keyHint?: string;
  plan?: string;
  provider: string;
  reason?: ProviderUsageReason;
  spend?: ProviderUsageSpend;
  status: ProviderUsageStatus;
  /** Present for admin providers when the user saved their own admin key. */
  storedCredential?: ProviderUsageStoredCredential;
  /** True when the endpoint is not part of the vendor's documented API. */
  unofficial?: boolean;
  windows?: ProviderUsageWindow[];
};

export type ProviderUsageCredential = {
  apiKey: string;
  baseURL?: string;
  teamId?: string;
};

export type ProviderUsageFetchContext = {
  /**
   * Operator proxy hostname that may be a private address. Other hosts on the
   * same read are still refused when they are not public.
   */
  allowPrivateHost?: string;
  credential: ProviderUsageCredential;
  fetchFn: typeof fetch;
  now: Date;
  resolveHost?: (hostname: string) => Promise<string[]>;
  timeoutMs: number;
};

export type ProviderUsageAdapterResult = Pick<
  ProviderUsageSnapshot,
  'balances' | 'isAvailable' | 'plan' | 'reason' | 'spend' | 'status' | 'unofficial' | 'windows'
>;

export type ProviderUsageAdapter = {
  credentialType: ProviderUsageCredentialType;
  fetchUsage: (context: ProviderUsageFetchContext) => Promise<ProviderUsageAdapterResult>;
  provider: string;
};
