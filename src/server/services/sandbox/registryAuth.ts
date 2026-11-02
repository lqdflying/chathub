import type { SandboxRegistryLogin } from './profiles/schema';

const DOCKER_HUB = 'docker.io';
const DOCKER_HUB_ALIASES = new Set(['index.docker.io', 'registry-1.docker.io']);

/** Lowercase registry host; Docker Hub's aliases become `docker.io`. */
export const normalizeRegistryHost = (host: string) => {
  const lower = host.trim().toLowerCase();
  return DOCKER_HUB_ALIASES.has(lower) ? DOCKER_HUB : lower;
};

/**
 * The registry host of an image reference, as Docker reads it: the first
 * path part when it has a dot or a port or is `localhost`, else Docker Hub.
 */
export const imageRegistryHost = (image: string) => {
  const [first, ...rest] = image.trim().split('/');
  const named =
    rest.length > 0 && (first.includes('.') || first.includes(':') || first === 'localhost');
  return normalizeRegistryHost(named ? first : DOCKER_HUB);
};

/** The login a server has for the registry an image comes from, if any. */
export const registryLoginFor = (image: string, registries: SandboxRegistryLogin[] = []) => {
  const host = imageRegistryHost(image);
  return registries.find((registry) => normalizeRegistryHost(registry.host) === host);
};
