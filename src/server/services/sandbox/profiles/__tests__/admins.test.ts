// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn() }));

vi.mock('@/database/models/user', () => ({ UserModel: { findById: mocks.findById } }));
vi.mock('@/envs/sandbox', () => ({ sandboxEnv: {} }));

const { hasSandboxHubAdmins, isSandboxHubAdmin, parseSandboxHubAdmins } = await import(
  '../admins'
);

const db = {} as never;

describe('Sandbox Hub admins', () => {
  beforeEach(() => {
    mocks.findById.mockReset();
  });

  it('splits ids and emails, lowercasing emails and skipping blanks', () => {
    const admins = parseSandboxHubAdmins(' user_1 , Ops@Example.COM,, ');
    expect([...admins.ids]).toEqual(['user_1']);
    expect([...admins.emails]).toEqual(['ops@example.com']);
  });

  it('has no admins when the list is unset', async () => {
    expect(hasSandboxHubAdmins()).toBe(false);
    expect(hasSandboxHubAdmins(parseSandboxHubAdmins('a@b.c'))).toBe(true);
    await expect(isSandboxHubAdmin(db, 'user_1')).resolves.toBe(false);
    await expect(isSandboxHubAdmin(db, 'user_1', parseSandboxHubAdmins(''))).resolves.toBe(false);
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('matches a user id without a lookup', async () => {
    await expect(isSandboxHubAdmin(db, 'user_1', parseSandboxHubAdmins('user_1'))).resolves.toBe(
      true,
    );
    expect(mocks.findById).not.toHaveBeenCalled();
  });

  it('matches the account email case-insensitively', async () => {
    const admins = parseSandboxHubAdmins('ops@example.com');
    mocks.findById.mockResolvedValue({ email: ' Ops@Example.com ' });
    await expect(isSandboxHubAdmin(db, 'user_2', admins)).resolves.toBe(true);
    expect(mocks.findById).toHaveBeenCalledWith(db, 'user_2');

    mocks.findById.mockResolvedValue({ email: 'someone@example.com' });
    await expect(isSandboxHubAdmin(db, 'user_3', admins)).resolves.toBe(false);
    mocks.findById.mockResolvedValue({ email: null });
    await expect(isSandboxHubAdmin(db, 'user_4', admins)).resolves.toBe(false);
    mocks.findById.mockResolvedValue(undefined);
    await expect(isSandboxHubAdmin(db, 'user_5', admins)).resolves.toBe(false);
  });
});
