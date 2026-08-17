import { uuid } from '@lobechat/utils';

export const createServerPlaceholderGenerators = (profile?: {
  email?: string | null;
  fullName?: string | null;
  nickname?: string | null;
  username?: string | null;
}) => ({
  date: () => new Date().toLocaleDateString(),
  datetime: () => new Date().toLocaleString(),
  day: () => new Date().getDate().toString().padStart(2, '0'),
  email: () => profile?.email ?? '',
  hour: () => new Date().getHours().toString().padStart(2, '0'),
  iso: () => new Date().toISOString(),
  locale: () => Intl.DateTimeFormat().resolvedOptions().locale,
  minute: () => new Date().getMinutes().toString().padStart(2, '0'),
  month: () => (new Date().getMonth() + 1).toString().padStart(2, '0'),
  nickname: () => profile?.nickname ?? profile?.fullName ?? '',
  random: () => Math.floor(Math.random() * 1_000_000 + 1).toString(),
  random_bool: () => (Math.random() > 0.5 ? 'true' : 'false'),
  random_float: () => (Math.random() * 100).toFixed(2),
  random_hex: () => Math.floor(Math.random() * 0xff_ffff)
    .toString(16)
    .padStart(6, '0'),
  random_int: () => Math.floor(Math.random() * 100).toString(),
  random_string: () => Math.random().toString(36).slice(2, 12),
  second: () => new Date().getSeconds().toString().padStart(2, '0'),
  time: () => new Date().toLocaleTimeString(),
  timestamp: () => Date.now().toString(),
  timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  username: () => profile?.username ?? profile?.fullName ?? profile?.nickname ?? '',
  uuid: () => uuid(),
  weekday: () => new Date().toLocaleDateString('en-US', { weekday: 'long' }),
  year: () => new Date().getFullYear().toString(),
});
