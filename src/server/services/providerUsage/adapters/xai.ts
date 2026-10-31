import { bearer, requestUsageJson } from '../http';
import { asFiniteNumber, asOptionalString, asRecord, statusFromHttp } from '../parse';
import type { ProviderUsageAdapter, ProviderUsageAdapterResult, ProviderUsageFetchContext } from '../types';

/**
 * xAI Management API (management key, not the inference key).
 * GET /v1/billing/teams/{team_id}/prepaid/balance returns `total.val` in USD
 * cents as an inverted ledger: the documented example shows a $10 purchase as
 * `"-1000"`, so the spendable balance is `-total / 100`.
 * @see https://docs.x.ai/developers/rest-api-reference/management/billing
 */
export const XAI_MANAGEMENT_BASE_URL = 'https://management-api.x.ai';

export const resolveXaiPrepaidBalanceUrl = (teamId: string) =>
  `${XAI_MANAGEMENT_BASE_URL}/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`;

/** Team-scoped keys expose their team; organization-scoped keys do not. */
export const XAI_MANAGEMENT_KEY_VALIDATION_URL = `${XAI_MANAGEMENT_BASE_URL}/auth/management-keys/validation`;

export const parseXaiManagementTeamId = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const teamId = asOptionalString(root.teamId);
  if (teamId) return teamId;
  const scope = (asOptionalString(root.scope) ?? '').toUpperCase();
  if (scope === 'SCOPE_ORGANIZATION') return undefined;
  return asOptionalString(root.scopeId);
};

export const parseXaiPrepaidBalance = (payload: unknown): ProviderUsageAdapterResult => {
  const cents = asFiniteNumber(asRecord(asRecord(payload).total).val);
  if (cents === undefined) return { status: 'error' };
  // `+ 0` turns -0 into 0 so an empty ledger does not render as "-$0.00".
  const balance = -cents / 100 + 0;
  return {
    balances: [{ currency: 'USD', total: balance }],
    isAvailable: balance > 0,
    status: 'ok',
  };
};

export const discoverXaiTeamId = async (
  context: ProviderUsageFetchContext,
  apiKey: string,
): Promise<{ teamId: string } | ProviderUsageAdapterResult> => {
  const validation = await requestUsageJson(
    context,
    XAI_MANAGEMENT_KEY_VALIDATION_URL,
    bearer(apiKey),
  );
  if (validation.status === 401 || validation.status === 403) return { status: 'authError' };
  if (!validation.ok) return { status: 'error' };
  const teamId = parseXaiManagementTeamId(validation.body);
  if (!teamId) return { reason: 'teamIdRequired', status: 'error' };
  return { teamId };
};

export const xaiUsageAdapter: ProviderUsageAdapter = {
  credentialType: 'admin',
  fetchUsage: async (context) => {
    const auth = bearer(context.credential.apiKey);
    let teamId = asOptionalString(context.credential.teamId);

    if (!teamId) {
      const discovered = await discoverXaiTeamId(context, context.credential.apiKey);
      if (!('teamId' in discovered)) return discovered;
      teamId = discovered.teamId;
    }

    const response = await requestUsageJson(context, resolveXaiPrepaidBalanceUrl(teamId), auth);
    if (!response.ok) return { status: statusFromHttp(response.status) };
    return parseXaiPrepaidBalance(response.body);
  },
  provider: 'xai',
};
