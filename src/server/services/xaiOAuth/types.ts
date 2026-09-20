export type XaiOAuthUsageWindow = {
  label: 'Monthly' | 'Usage' | 'Weekly';
  remainingPercent?: number;
  resetsAt?: string;
  usedPercent?: number;
  windowMinutes?: number;
  windowSeconds?: number;
};

export type XaiOAuthConnectionStatus = {
  connected: boolean;
  email?: string;
  expiresAt?: string;
  fiveHour?: XaiOAuthUsageWindow;
  plan?: string;
  weekly?: XaiOAuthUsageWindow;
};

export type XaiOAuthDeviceLoginStart = {
  expiresAt: string;
  handoffId: string;
  intervalMs: number;
  userCode: string;
  verificationUrl: string;
};

export type XaiOAuthDeviceLoginPoll =
  | { status: 'expired' }
  | { intervalMs: number; nextDelayMs: number; status: 'pending' }
  | { message?: string; status: 'denied' }
  | (XaiOAuthConnectionStatus & { status: 'connected' });

export type XaiOAuthLiveSession = {
  accessToken: string;
  email?: string;
  expiresAt: Date;
  plan?: string;
  tokenEndpoint?: string;
};

export type XaiOAuthRuntimePurpose = 'chat' | 'structured';
