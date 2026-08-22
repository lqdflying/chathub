export interface DifySandboxRunResponse {
  code?: number;
  data?: {
    error?: string | null;
    stdout?: string | null;
  };
  message?: string;
}
