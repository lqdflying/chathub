export const parseAuthProviders = (value: string) => {
  return value
    .trim()
    .split(/[,，]/)
    .map((provider) => provider.trim())
    .filter(Boolean);
};