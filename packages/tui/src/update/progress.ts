export type RigUpdatePhase =
  | 'checking'
  | 'downloading'
  | 'staging'
  | 'installing'
  | 'validating'
  | 'activating'
  | 'completed';

export interface RigUpdatePhaseEvent {
  readonly phase: RigUpdatePhase;
  readonly cancellable: boolean;
}

export interface RigUpdateOperationOptions {
  readonly signal?: AbortSignal;
  readonly onOutput?: (chunk: string) => void;
  readonly onPhase?: (event: RigUpdatePhaseEvent) => void;
}

export class RigUpdateCancelledError extends Error {
  constructor(message = 'Rig update cancelled; the previous installation remains active.') {
    super(message);
    this.name = 'RigUpdateCancelledError';
  }
}

export class RigUpdateAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigUpdateAdmissionError';
  }
}

export function throwIfRigUpdateCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RigUpdateCancelledError();
}

export function reportRigUpdatePhase(
  options: Pick<RigUpdateOperationOptions, 'onPhase'>,
  phase: RigUpdatePhase,
  cancellable: boolean,
): void {
  try {
    options.onPhase?.({ phase, cancellable });
  } catch {
    // Presentation observers must not change update safety or outcome.
  }
}

export function isRigUpdateCancelledError(error: unknown): error is RigUpdateCancelledError {
  return error instanceof RigUpdateCancelledError;
}

export function isRigUpdateAdmissionError(error: unknown): error is RigUpdateAdmissionError {
  return error instanceof RigUpdateAdmissionError;
}
