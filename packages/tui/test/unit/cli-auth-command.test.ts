import { describe, expect, it, vi } from 'vitest';

import { runTuiLogin, runTuiLogout } from '../../src/cli/auth-command.js';

describe('Rig auth commands', () => {
  it.each([true, false])('returns after dispatching browser logout (%s)', async (openBrowser) => {
    const writeError = vi.fn();
    const logoutUrl =
      'https://agent.rig.cn/auth/logout?logout_redirect_uri=https%3A%2F%2Fagent.rig.cn';
    const logout = vi.fn(async () => ({
      state: 'signed-out' as const,
      message: 'Signed out of Rig.',
      logoutUrl,
    }));
    const openExternalTarget = vi.fn(() => {
      expect(logout).toHaveBeenCalledOnce();
      expect(writeError).toHaveBeenCalledWith(expect.stringContaining(logoutUrl));
      return new Promise<void>(() => {});
    });

    await expect(
      runTuiLogout({
        createApplication: () => ({ login: vi.fn(), logout }),
        writeError,
        openBrowser,
        openExternalTarget,
      }),
    ).resolves.toBe('Signed out of Rig.');

    expect(logout).toHaveBeenCalledOnce();
    expect(writeError).toHaveBeenCalledWith(`Finish signing out in your browser:\n${logoutUrl}\n`);
    if (openBrowser) expect(openExternalTarget).toHaveBeenCalledWith(logoutUrl);
    else expect(openExternalTarget).not.toHaveBeenCalled();
  });

  it.each(['reject', 'throw'] as const)(
    'keeps logout successful when browser startup fails by %s',
    async (failure) => {
      const writeError = vi.fn();
      const logoutUrl =
        'https://agent.rig.cn/auth/logout?logout_redirect_uri=https%3A%2F%2Fagent.rig.cn';
      const logout = vi.fn(async () => ({
        state: 'signed-out' as const,
        message: 'Signed out of Rig.',
        logoutUrl,
      }));

      await expect(
        runTuiLogout({
          createApplication: () => ({ login: vi.fn(), logout }),
          writeError,
          openExternalTarget: () => {
            const error = new Error('no desktop session');
            if (failure === 'throw') throw error;
            return Promise.reject(error);
          },
        }),
      ).resolves.toBe('Signed out of Rig.');

      expect(writeError).toHaveBeenCalledWith(expect.stringContaining(logoutUrl));
      expect(writeError).toHaveBeenLastCalledWith(
        "Couldn't open the default browser. Open the sign-out URL above manually.\n",
      );
    },
  );

  it('creates the logout application for the explicitly selected region', async () => {
    const logout = vi.fn(async () => ({
      state: 'signed-out' as const,
      message: 'Signed out of Rig Global.',
    }));
    const createApplication = vi.fn(() => ({ login: vi.fn(), logout }));

    await runTuiLogout({ region: 'en', createApplication });

    expect(createApplication).toHaveBeenCalledWith('en');
    expect(logout).toHaveBeenCalledOnce();
  });

  it('prints Device Flow instructions without exposing the internal device_code', async () => {
    const stderr: string[] = [];
    const openedTargets: string[] = [];
    const login = vi.fn(async (onProgress) => {
      onProgress?.({
        state: 'device-authorization',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://account.example.test/device',
        verificationUriComplete:
          'https://account.example.test/device?user_code=ABCD-EFGH',
        expiresInSec: 300,
      });
      return { state: 'authenticated' as const, message: 'Signed in with Rig.' };
    });

    await runTuiLogin({
      region: 'en',
      createApplication: () => ({ login, logout: vi.fn() }),
      writeError: (value) => stderr.push(value),
      openExternalTarget: async (target) => {
        openedTargets.push(target);
      },
    });

    expect(stderr.join('')).toBe(
      'Open: https://account.example.test/device?user_code=ABCD-EFGH&client_surface=tui&download_source=rig-internal\nCode: ABCD-EFGH\nWaiting for authorization…\n',
    );
    expect(openedTargets).toEqual([
      'https://account.example.test/device?user_code=ABCD-EFGH&client_surface=tui&download_source=rig-internal',
    ]);
    expect(stderr.join('')).not.toContain('device-secret');
  });

  it('keeps rig login usable without a desktop browser when explicitly disabled', async () => {
    const stderr: string[] = [];
    const openedTargets: string[] = [];
    const login = vi.fn(async (onProgress) => {
      onProgress?.({
        state: 'device-authorization',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://account.example.test/device',
        expiresInSec: 300,
      });
      return { state: 'authenticated' as const, message: 'Signed in with Rig.' };
    });

    await runTuiLogin({
      openBrowser: false,
      createApplication: () => ({ login, logout: vi.fn() }),
      writeError: (value) => stderr.push(value),
      openExternalTarget: async (target) => {
        openedTargets.push(target);
      },
    });

    expect(openedTargets).toEqual([]);
    expect(stderr.join('')).toContain(
      'Open: https://account.example.test/device?client_surface=tui&download_source=rig-internal',
    );
  });

  it('continues Device Flow when opening the default browser fails', async () => {
    const stderr: string[] = [];
    const login = vi.fn(async (onProgress) => {
      onProgress?.({
        state: 'device-authorization',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://account.example.test/device',
        expiresInSec: 300,
      });
      return { state: 'authenticated' as const, message: 'Signed in with Rig.' };
    });

    await expect(
      runTuiLogin({
        createApplication: () => ({ login, logout: vi.fn() }),
        writeError: (value) => stderr.push(value),
        openExternalTarget: async () => {
          throw new Error('no desktop session');
        },
      }),
    ).resolves.toBe('Signed in with Rig.');
    await vi.waitFor(() =>
      expect(stderr.join('')).toContain(
        "Couldn't open the default browser. Open the authorization URL above manually.",
      ),
    );
  });
  it('rejects an unknown provider id with the roster error', async () => {
    await expect(runTuiLogin({ provider: 'nope' })).rejects.toThrow(
      "Unknown provider 'nope'. Run 'rig login' to pick one.",
    );
  });

  it('stores an api-key provider login through the injected runner', async () => {
    const runProviderLogin = vi.fn(async () => ({ message: 'Logged in to Together.' }));
    await expect(
      runTuiLogin({
        provider: 'together',
        runProviderLogin,
        writeError: () => undefined,
        writeOut: () => undefined,
        openExternalTarget: async () => undefined,
      }),
    ).resolves.toBe('Logged in to Together.');
    expect(runProviderLogin).toHaveBeenCalledOnce();
    expect(runProviderLogin.mock.calls[0]?.[0]).toBe('together');
  });

  it('rejects an unknown provider id on logout with the roster error', async () => {
    await expect(runTuiLogout({ provider: 'nope' })).rejects.toThrow(
      "Unknown provider 'nope'. Run 'rig login' to pick one.",
    );
  });

  it('keeps rig login on the legacy device flow when no provider is given', async () => {
    const login = vi.fn(async () => ({ message: 'Signed in with Rig.' }));
    await expect(
      runTuiLogin({
        createApplication: () => ({ login, logout: vi.fn() }),
        writeError: () => undefined,
        openBrowser: false,
      }),
    ).resolves.toBe('Signed in with Rig.');
    expect(login).toHaveBeenCalledOnce();
  });
});
