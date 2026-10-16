import { isAppleInstalledApp } from '../platform';

export type IosDownloadFailure = 'fetch_failed' | 'share_unavailable';

export interface IosDownloadUi {
  promptSave: (file: File) => Promise<void>;
  reportError: (reason: IosDownloadFailure) => void;
}

let iosDownloadUi: IosDownloadUi | undefined;

export const setIosDownloadUi = (ui: IosDownloadUi | undefined) => {
  iosDownloadUi = ui;
};

const isSameOrigin = (url: string) => {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
};

const saveWithAnchor = (blob: Blob, fileName: string) => {
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  link.style.display = 'none';

  document.body.append(link);
  link.click();

  link.remove();
  window.URL.revokeObjectURL(blobUrl);
};

const reportIosDownloadError = (reason: IosDownloadFailure) => {
  iosDownloadUi?.reportError(reason);
};

const promptIosSave = async (file: File) => {
  if (!iosDownloadUi) {
    reportIosDownloadError('share_unavailable');
    return;
  }
  await iosDownloadUi.promptSave(file);
};

const shareInstalledFile = async (file: File) => {
  let canShare = false;
  try {
    canShare =
      navigator.canShare?.({ files: [file] }) === true && typeof navigator.share === 'function';
  } catch {
    canShare = false;
  }

  if (!canShare || !navigator.share) {
    reportIosDownloadError('share_unavailable');
    return;
  }

  // A long fetch can outlive the tap. Share then, from a second tap.
  if (navigator.userActivation && navigator.userActivation.isActive === false) {
    await promptIosSave(file);
    return;
  }

  try {
    await navigator.share({ files: [file] });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'AbortError') return;
    if (name === 'NotAllowedError') {
      await promptIosSave(file);
      return;
    }
    reportIosDownloadError('share_unavailable');
  }
};

export const downloadFile = async (
  url: string,
  fileName: string,
  fallbackToOpen: boolean = true,
) => {
  const installedAppleApp = isAppleInstalledApp();

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: isSameOrigin(url) ? 'include' : 'omit',
      mode: 'cors',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    if (installedAppleApp) {
      const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
      await shareInstalledFile(file);
      return;
    }

    saveWithAnchor(blob, fileName);
  } catch (error) {
    console.log('Download failed:', error);

    if (installedAppleApp) {
      reportIosDownloadError('fetch_failed');
      return;
    }

    if (fallbackToOpen) {
      window.open(url);
    } else {
      throw error;
    }
  }
};
