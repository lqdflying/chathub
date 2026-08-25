export const getArtifactAspectRatio = (width?: number | null, height?: number | null) => {
  if (width && height && width > 0 && height > 0) return `${width} / ${height}`;

  return '16 / 9';
};
