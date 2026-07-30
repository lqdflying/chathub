export const IMAGE_REFERENCE_ERROR_MESSAGES = {
  ambiguousStoredReference:
    'Stored image reference format is ambiguous and cannot be regenerated safely',
  protocolRelativeReference: 'Protocol-relative image references are not supported',
  unauthorizedReference: 'Image reference does not belong to the current user',
  unsupportedStoredReferenceVersion: 'Stored image reference format version is not supported',
} as const;
