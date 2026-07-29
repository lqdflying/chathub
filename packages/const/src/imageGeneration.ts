export const IMAGE_REFERENCE_ERROR_MESSAGES = {
  ambiguousStoredReference:
    'Stored image reference format is ambiguous and cannot be regenerated safely',
  protocolRelativeReference: 'Protocol-relative image references are not supported',
  unsupportedStoredReferenceVersion: 'Stored image reference format version is not supported',
} as const;
