export type OpenAICodexConnectionStatus = {
  chatgptPlanType?: string;
  connected: boolean;
  email?: string;
  expiresAt?: string;
};

export type OpenAICodexDeviceLoginStart = {
  expiresAt: string;
  handoffId: string;
  userCode: string;
  verificationUrl: string;
};

export type ConversationRuntimePurpose = 'chat' | 'structured';

export type OpenAICodexDeviceLoginPoll =
  | { status: 'expired' }
  | { status: 'pending' }
  | { message?: string; status: 'denied' }
  | (OpenAICodexConnectionStatus & { status: 'connected' });

export type OpenAICodexLiveSession = {
  accessToken: string;
  accountId: string;
  chatgptPlanType?: string;
  email?: string;
  expiresAt: Date;
};
