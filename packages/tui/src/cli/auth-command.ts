import { createInterface } from 'node:readline';
import type { RigAuthApplication } from '../auth/application.js';
import { markTuiAuthorizationUrl } from '../auth/authorization-url.js';
import { createDefaultRigAuthApplication } from '../auth/factory.js';
import {
  createTuiExternalTargetOpener,
  type TuiExternalTargetOpener,
} from '../host/open-external.js';
import { prepareTuiDataDir } from '../runtime/data-dir.js';
import { createTuiRuntime, shutdownTuiRuntime } from '../runtime/lifecycle.js';
import { RigProviderApplication } from '../provider/application.js';
import { getRigLoginProvider } from '../login/provider-login-registry.js';
import { runProviderLogin } from '../login/run-provider-login.js';
import { createPortCredentialWriter } from '../login/credential-store.js';
import type { RigRegion } from '@rig/config';

interface TuiAuthCommandApplication {
  login: RigAuthApplication['login'];
  logout: RigAuthApplication['logout'];
}

export interface RunTuiAuthCommandOptions {
  readonly region?: RigRegion;
  readonly lane?: string;
  readonly provider?: string;
  readonly createApplication?: (region?: RigRegion) => TuiAuthCommandApplication;
  readonly writeError?: (value: string) => void;
  readonly writeOut?: (value: string) => void;
  readonly prepareDataDir?: typeof prepareTuiDataDir;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
  readonly runProviderLogin?: (
    providerId: string,
    controller: {
      onAuth?: (info: { url: string; instructions: string }) => void;
      onPrompt?: (prompt: { message: string; placeholder?: string }) => Promise<string>;
      onProgress?: (message: string) => void;
    },
  ) => Promise<{ message: string }>;
}

export async function runTuiLogin(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  const requested = options.provider?.trim();
  const providerId = requested === undefined || requested === '' ? 'rig' : requested;
  if (providerId !== 'rig') {
    if (!getRigLoginProvider(providerId)) {
      throw new Error(`Unknown provider '${providerId}'. Run 'rig login' to pick one.`);
    }
    return runTuiProviderLogin(options, providerId);
  }
  const application = options.createApplication
    ? options.createApplication(options.region)
    : await createAuthApplication(options.region, options.prepareDataDir);
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));
  const result = await application.login((progress) => {
    const authorizationUrl = markTuiAuthorizationUrl(
      progress.verificationUriComplete ?? progress.verificationUri,
    );
    writeError(
      `Open: ${authorizationUrl}\nCode: ${progress.userCode}\nWaiting for authorization…\n`,
    );
    if (options.openBrowser === false) return;
    const openExternalTarget =
      options.openExternalTarget ?? createTuiExternalTargetOpener(process.cwd());
    void openExternalTarget(authorizationUrl).catch(() => {
      writeError("Couldn't open the default browser. Open the authorization URL above manually.\n");
    });
  });
  return result.message;
}

export async function runTuiLogout(options: RunTuiAuthCommandOptions = {}): Promise<string> {
  const providerId = options.provider?.trim();
  if (providerId !== undefined && providerId !== '' && providerId !== 'rig') {
    if (!getRigLoginProvider(providerId)) {
      throw new Error(`Unknown provider '${providerId}'. Run 'rig login' to pick one.`);
    }
    const runtime = await createTuiRuntime({
      dataDir: await (options.prepareDataDir ?? prepareTuiDataDir)(),
      workspaceDir: process.cwd(),
      version: 'cli',
      surface: 'headless',
    });
    try {
      const writer = createPortCredentialWriter(runtime.adapter, {
        prepareDataDir: options.prepareDataDir ?? prepareTuiDataDir,
      });
      await writer.deleteCredential(providerId);
      return `Signed out of ${providerId}.`;
    } finally {
      await shutdownTuiRuntime(runtime);
    }
  }
  const application = options.createApplication
    ? options.createApplication(options.region)
    : await createAuthApplication(options.region, options.prepareDataDir);
  const result = await application.logout();
  if (result.logoutUrl) {
    const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));
    writeError(`Finish signing out in your browser:\n${result.logoutUrl}\n`);
    if (options.openBrowser !== false) {
      const reportOpenFailure = () =>
        writeError("Couldn't open the default browser. Open the sign-out URL above manually.\n");
      try {
        const openExternalTarget =
          options.openExternalTarget ?? createTuiExternalTargetOpener(process.cwd());
        void openExternalTarget(result.logoutUrl).catch(reportOpenFailure);
      } catch {
        reportOpenFailure();
      }
    }
  }
  return result.message;
}


async function createAuthApplication(
  region?: RigRegion,
  prepareDataDirFn: typeof prepareTuiDataDir = prepareTuiDataDir,
): Promise<RigAuthApplication> {
  return createDefaultRigAuthApplication({
    dataDir: await prepareDataDirFn(),
    ...(region ? { region } : {}),
  });
}

async function runTuiProviderLogin(
  options: RunTuiAuthCommandOptions,
  providerId: string,
): Promise<string> {
  const writeError = options.writeError ?? ((value: string) => process.stderr.write(value));
  const writeOut = options.writeOut ?? ((value: string) => process.stdout.write(value));
  const runLogin = options.runProviderLogin ?? defaultRunProviderLogin;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = (message: string) =>
      new Promise<string>((resolve) => {
        rl.question(message, resolve);
      });
    const result = await runLogin(providerId, {
      onAuth: (info) => {
        writeError(`\nOpen this URL in your browser:\n${info.url}\n`);
        if (info.instructions) writeError(`${info.instructions}\n`);
        writeError('\n');
        if (options.openBrowser === false) return;
        const openExternalTarget =
          options.openExternalTarget ?? createTuiExternalTargetOpener(process.cwd());
        void openExternalTarget(info.url).catch(() => {
          writeError("Couldn't open the default browser. Open the URL above manually.\n");
        });
      },
      onProgress: (message) => {
        writeError(`${message}\n`);
      },
      onPrompt: async (prompt) => {
        writeOut(`${prompt.message}${prompt.placeholder ? ` (${prompt.placeholder})` : ''}: `);
        return ask('');
      },
    });
    return result.message;
  } finally {
    rl.close();
  }
}

async function defaultRunProviderLogin(
  providerId: string,
  controller: {
    onAuth?: (info: { url: string; instructions: string }) => void;
    onPrompt?: (prompt: { message: string; placeholder?: string }) => Promise<string>;
    onProgress?: (message: string) => void;
  },
): Promise<{ message: string }> {
  const runtime = await createTuiRuntime({
    dataDir: await prepareTuiDataDir(),
    workspaceDir: process.cwd(),
    version: 'cli',
    surface: 'headless',
  });
  try {
    const application = new RigProviderApplication(runtime.adapter);
    const writer = createPortCredentialWriter(runtime.adapter, {
      prepareDataDir: prepareTuiDataDir,
      listTemplates: async () => runtime.adapter.listProviderPresets(),
    });
    return runProviderLogin(providerId, controller, writer, {
      startCodexOAuth: async () => {
        await application.connectCodexOAuth();
      },
    });
  } finally {
    await shutdownTuiRuntime(runtime);
  }
}
