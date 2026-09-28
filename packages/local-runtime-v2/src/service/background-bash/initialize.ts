import type { BashEnvPolicy } from '@rig/agent-core/bash-subprocess-env';
import type { LocalSandboxBashOperationsFactory } from '@rig/agent-tools/desktop';

import { createLocalBackgroundBashExecutor } from './executor.js';

export function initializeLocalBackgroundBashExecutor(
  operationsFactory: LocalSandboxBashOperationsFactory,
  envPolicy: BashEnvPolicy,
) {
  return createLocalBackgroundBashExecutor(operationsFactory, envPolicy);
}
