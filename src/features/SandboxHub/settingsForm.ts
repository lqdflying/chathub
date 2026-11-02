import type {
  SandboxHubProfileSettingsInput,
  SandboxHubProfileSettingsItem,
  SandboxProfileEgress,
} from '@lobechat/types';

export type NetworkChoice = 'allowlist' | 'inherit' | 'none' | 'open';

/** The profile editor's fields as typed; numbers stay text until saved. */
export interface ProfileFormState {
  allowlist: string;
  avatar: string;
  cpu: string;
  defaultEnabled: boolean;
  description: string;
  id: string;
  idleMinutes: string;
  image: string;
  instructionBase: 'general' | 'none';
  instructionText: string;
  jobMinutes: string;
  maxLifetimeMinutes: string;
  memory: string;
  name: string;
  network: NetworkChoice;
  readySeconds: string;
  serverId: string;
}

const MINUTE_MS = 60_000;

const msToUnit = (ms: number | null | undefined, unitMs: number) =>
  ms === null || ms === undefined ? '' : String(Math.round((ms / unitMs) * 100) / 100);

/** A new profile's form, or an existing profile's settings as form fields. */
export const toFormState = (
  item: SandboxHubProfileSettingsItem | undefined,
  defaultServerId: string,
): ProfileFormState => {
  const egress = item?.egress;
  return {
    allowlist: Array.isArray(egress) ? egress.join('\n') : '',
    avatar: item?.avatar ?? '',
    cpu: item?.cpu ?? '',
    defaultEnabled: item?.defaultEnabled ?? false,
    description: item?.description ?? '',
    id: item?.id ?? '',
    idleMinutes: msToUnit(item?.sessionIdleTimeoutMs, MINUTE_MS),
    image: item?.image ?? '',
    instructionBase: item?.instructionBase ?? 'general',
    instructionText: item?.instructionText ?? '',
    jobMinutes: msToUnit(item?.jobMaxRuntimeMs, MINUTE_MS),
    maxLifetimeMinutes: msToUnit(item?.sessionMaxLifetimeMs, MINUTE_MS),
    memory: item?.memory ?? '',
    name: item?.name ?? '',
    network: Array.isArray(egress) ? 'allowlist' : (egress ?? 'inherit'),
    readySeconds: msToUnit(item?.readyTimeoutMs, 1000),
    serverId: item?.serverId ?? defaultServerId,
  };
};

export type FormError =
  | { field: 'allowlist' | 'idleMinutes' | 'jobMinutes' | 'maxLifetimeMinutes' | 'readySeconds' }
  | { field: 'description' | 'name' | 'serverId' };

/** A blank field inherits (null); otherwise a non-negative number of `unitMs`. */
const parseDuration = (value: string, unitMs: number): number | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed * unitMs);
};

/** Allowlist entries split on commas, spaces and new lines, without duplicates. */
export const parseAllowlist = (value: string) => [
  ...new Set(
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

/**
 * The form as settings to save. Field-level problems are returned for the
 * form to show; everything else is checked by the server with the
 * profiles-file rules.
 */
export const toSettingsInput = (
  form: ProfileFormState,
): { error: FormError; ok: false } | { input: SandboxHubProfileSettingsInput; ok: true } => {
  if (!form.name.trim()) return { error: { field: 'name' }, ok: false };
  if (!form.description.trim()) return { error: { field: 'description' }, ok: false };
  if (!form.serverId) return { error: { field: 'serverId' }, ok: false };

  const durations = {
    idleMinutes: parseDuration(form.idleMinutes, MINUTE_MS),
    jobMinutes: parseDuration(form.jobMinutes, MINUTE_MS),
    maxLifetimeMinutes: parseDuration(form.maxLifetimeMinutes, MINUTE_MS),
    readySeconds: parseDuration(form.readySeconds, 1000),
  };
  for (const [field, value] of Object.entries(durations)) {
    if (value === undefined)
      return { error: { field: field as keyof typeof durations }, ok: false };
  }

  let egress: SandboxHubProfileSettingsInput['egress'] = null;
  if (form.network === 'open' || form.network === 'none') egress = form.network;
  if (form.network === 'allowlist') {
    const targets = parseAllowlist(form.allowlist);
    if (targets.length === 0) return { error: { field: 'allowlist' }, ok: false };
    egress = targets;
  }

  return {
    input: {
      avatar: form.avatar.trim() || null,
      cpu: form.cpu.trim() || null,
      defaultEnabled: form.defaultEnabled,
      description: form.description.trim(),
      egress,
      image: form.image.trim() || null,
      instructionBase: form.instructionBase,
      instructionText: form.instructionText.trim() ? form.instructionText : null,
      jobMaxRuntimeMs: durations.jobMinutes,
      memory: form.memory.trim() || null,
      name: form.name.trim(),
      readyTimeoutMs: durations.readySeconds,
      serverId: form.serverId,
      sessionIdleTimeoutMs: durations.idleMinutes,
      sessionMaxLifetimeMs: durations.maxLifetimeMinutes,
    },
    ok: true,
  };
};

/** Plain text for an inherited network policy. */
export const egressLabelKey = (egress: SandboxProfileEgress) =>
  `admin.form.networkDefault.${egress.mode}` as const;
