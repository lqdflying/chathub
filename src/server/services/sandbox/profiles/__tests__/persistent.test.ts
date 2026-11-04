// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { persistentMount, persistentVolumeName, persistentVolumeSpec } from '../persistent';

describe('persistent folder volumes', () => {
  it('names one volume per user and profile, as a valid claim name without raw ids', () => {
    const name = persistentVolumeName('data', 'user_2abcDEF');
    expect(name).toMatch(/^chathub-[\da-f]{40}$/);
    expect(name).toMatch(/^[\da-z]([\da-z-]*[\da-z])?$/);
    expect(name).not.toContain('user_2abcDEF');
    expect(persistentVolumeName('data', 'user_2abcDEF')).toBe(name);
    expect(persistentVolumeName('general', 'user_2abcDEF')).not.toBe(name);
    expect(persistentVolumeName('data', 'user_other')).not.toBe(name);
  });

  it('mounts only for a profile with a persistent folder', () => {
    expect(persistentMount({ id: 'data' }, 'u1')).toBeUndefined();
    expect(persistentVolumeSpec({ id: 'data' }, 'u1')).toEqual({});

    const spec = persistentVolumeSpec({ id: 'data', persistentFolder: '/persist' }, 'u1');
    expect(spec.mount).toEqual({
      claimName: persistentVolumeName('data', 'u1'),
      mountPath: '/persist',
    });
    expect(spec.fingerprint).toMatch(/^[\da-f]{16}$/);
    // A new mount path is a different label, so sandboxes are replaced; the volume is the same.
    const moved = persistentVolumeSpec({ id: 'data', persistentFolder: '/data' }, 'u1');
    expect(moved.fingerprint).not.toBe(spec.fingerprint);
    expect(moved.mount?.claimName).toBe(spec.mount?.claimName);
  });
});
