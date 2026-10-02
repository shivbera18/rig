import type { RigAuthApplication } from '../auth/application.js';
import { markTuiAuthorizationUrl } from '../auth/authorization-url.js';
import { createDefaultRigAuthApplication } from '../auth/factory.js';
import {
  createTuiExternalTargetOpener,
  type TuiExternalTargetOpener,
} from '../host/open-external.js';
import { prepareTuiDataDir } from '../runtime/data-dir.js';
import type { RigRegion } from '@rig/config';

interface TuiAuthCommandApplication {
  login: RigAuthApplication['login'];
  logout: RigAuthApplication['logout'];
}

export interface RunTuiAuthCommandOptions {
  readonly region?: RigRegion;
  readonly lane?: string;
  readonly createApplication?: (region?: RigRegion) => TuiAuthCommandApplication;
  readonly writeError?: (value: string) => void;
  readonly prepareDataDir?: typeof prepareTuiDataDir;
  readonly openBrowser?: boolean;
  readonly openExternalTarget?: TuiExternalTargetOpener;
}

export async function runTuiLogin(options: RunTuiAuthCommandOptions = {}): Promise<string> {
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
