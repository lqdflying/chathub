import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type UsageHostResolver = (hostname: string) => Promise<string[]>;

const BLOCKED_HOSTS = new Set(['metadata.google.internal', 'metadata.google.com']);

/** Cloud metadata addresses that are not already inside a blocked subnet. */
const METADATA_IPS = new Set(['100.100.100.200', '169.254.169.254', 'fd00:ec2::254']);

const NON_PUBLIC = new BlockList();
NON_PUBLIC.addSubnet('0.0.0.0', 8, 'ipv4');
NON_PUBLIC.addSubnet('10.0.0.0', 8, 'ipv4');
NON_PUBLIC.addSubnet('127.0.0.0', 8, 'ipv4');
NON_PUBLIC.addSubnet('169.254.0.0', 16, 'ipv4');
NON_PUBLIC.addSubnet('172.16.0.0', 12, 'ipv4');
NON_PUBLIC.addSubnet('192.168.0.0', 16, 'ipv4');
NON_PUBLIC.addSubnet('224.0.0.0', 4, 'ipv4');
NON_PUBLIC.addAddress('::', 'ipv6');
NON_PUBLIC.addAddress('::1', 'ipv6');
NON_PUBLIC.addSubnet('fc00::', 7, 'ipv6');
NON_PUBLIC.addSubnet('fe80::', 10, 'ipv6');
NON_PUBLIC.addSubnet('ff00::', 8, 'ipv6');

const normalizeIp = (address: string) => address.trim().toLowerCase().replaceAll(/^\[|]$/g, '');

const unwrapMappedIpv4 = (address: string) => {
  const mapped = normalizeIp(address).match(/^:{2}f{4}:((?:\d+\.){3}\d+)$/);
  return mapped?.[1] ?? normalizeIp(address);
};

const isMetadataAddress = (address: string) => METADATA_IPS.has(unwrapMappedIpv4(address));

export const isNonPublicAddress = (address: string) => {
  const ip = unwrapMappedIpv4(address);
  if (isMetadataAddress(ip)) return true;
  const family = isIP(ip);
  if (family === 4) return NON_PUBLIC.check(ip, 'ipv4');
  if (family === 6) return NON_PUBLIC.check(ip, 'ipv6');
  return true;
};

export const resolveUsageHost: UsageHostResolver = async (hostname) => {
  if (isIP(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

/**
 * Usage reads run on the ChatHub server. Allow http(s) only, and refuse
 * loopback, link-local, private, multicast, unspecified, and cloud-metadata
 * targets. `allowPrivateHost` is the operator proxy hostname, which may
 * itself be a private address; every other host is still checked.
 */
export const assessUsageUrl = async (
  url: string,
  options: { allowPrivateHost?: string; resolveHost: UsageHostResolver },
): Promise<boolean> => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();
  if (!hostname || BLOCKED_HOSTS.has(hostname)) return false;
  if (isIP(hostname) && isMetadataAddress(hostname)) return false;
  if (options.allowPrivateHost && hostname === options.allowPrivateHost) return true;

  let addresses: string[];
  try {
    addresses = isIP(hostname) ? [hostname] : await options.resolveHost(hostname);
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;
  return addresses.every((address) => !isNonPublicAddress(address));
};
