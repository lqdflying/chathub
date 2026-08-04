export const isStorageObjectMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const storageError = error as {
    $metadata?: { httpStatusCode?: number };
    Code?: string;
    code?: string;
    name?: string;
  };
  const code = storageError.Code ?? storageError.code ?? storageError.name;

  return (
    storageError.$metadata?.httpStatusCode === 404 ||
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    code === 'NoSuchObject'
  );
};
