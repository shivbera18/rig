import type {
  LocalSandboxBashExecutionPort,
  LocalSandboxBashOperationsFactory,
} from '@rig/agent-tools/desktop';

export interface DeferredLocalSandboxBashOperationsFactory extends LocalSandboxBashExecutionPort {
  bind(factory: LocalSandboxBashOperationsFactory): void;
}
