export interface PythonOutput {
  data: string;
  type: 'stdout' | 'stderr';
}

export interface PythonResult {
  output?: PythonOutput[];
  result?: string;
  success: boolean;
}

export interface CodeInterpreterParams {
  code: string;
  packages: string[];
}

export interface CodeInterpreterFileItem {
  data?: File;
  fileId?: string;
  filename: string;
  previewUrl?: string;
  /** UI proxy URL (`/webapi/files/...`). Older messages may omit this. */
  url?: string;
}

export interface CodeInterpreterResponse extends PythonResult {
  files?: CodeInterpreterFileItem[];
}

export interface CodeInterpreterState {
  error?: any;
}
