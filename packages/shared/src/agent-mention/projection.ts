import {
  AGENT_REFERENCE_ERROR_CODES,
  type AgentReferenceErrorCode,
  parseAgentReferences,
} from './protocol.js';

export type AgentMentionSurface = 'main' | 'direct-subagent' | 'task-child';

/**
 * Opt-in model presentation metadata from a trusted runtime resolver. The
 * legacy `'authorized'` result deliberately remains available to callers
 * which only know a stable request reference.
 */
export interface AuthorizedAgentReferenceResolution {
  readonly status: 'authorized';
  /** Server-originated label only; it is never an authorization input. */
  readonly trustedDisplayName?: string;
}

/** The trusted runtime resolver owns the distinction between absent and denied. */
export type AgentReferenceResolution =
  | 'authorized'
  | 'unknown'
  | 'unauthorized'
  | AuthorizedAgentReferenceResolution;

export interface ProjectAgentReferencesForModelOptions {
  readonly surface: AgentMentionSurface;
  readonly resolveAgentReference: (
    requestRef: string,
  ) => AgentReferenceResolution | Promise<AgentReferenceResolution>;
}

export interface ProjectAgentReferencesForModelResult {
  readonly content: string;
  readonly projectedCount: number;
  /** Stable outcomes only: never a body, display name, or request ref. */
  readonly errorCodes: readonly AgentReferenceErrorCode[];
}

function appendError(
  errorCodes: AgentReferenceErrorCode[],
  errorCode: AgentReferenceErrorCode,
): void {
  if (!errorCodes.includes(errorCode)) errorCodes.push(errorCode);
}

/** Keep this projection language-invariant: it is model protocol, not UI copy. */
export function projectAgentReferenceForModel(
  requestRef: string,
  authorizedReference?: AuthorizedAgentReferenceResolution,
): string {
  // Keep the pre-existing string-resolution contract intact for legacy
  // callers that have no trusted server label. The trusted label is for
  // user-facing replies; the exact request ref is only the Task `agent_name`.
  if (authorizedReference) {
    const displayName = authorizedReference.trustedDisplayName?.trim()
      ? authorizedReference.trustedDisplayName
      : requestRef;
    return `Invoke ${JSON.stringify(displayName)} Agent via Task tool (agent_name=${JSON.stringify(requestRef)}; use the display name when replying to the user; agent_name must match exactly)`;
  }
  return `Invoke ${requestRef} Agent via Task tool`;
}

function isAuthorizedAgentReferenceResolution(
  resolution: AgentReferenceResolution,
): resolution is 'authorized' | AuthorizedAgentReferenceResolution {
  return (
    resolution === 'authorized' ||
    (resolution !== null && typeof resolution === 'object' && resolution.status === 'authorized')
  );
}

/**
 * A valid persisted reference still denotes an internal Agent even when this
 * runtime surface cannot invoke it. Keep the display name as JSON data rather
 * than interpolating it as an instruction, so models do not mistake it for a
 * contact or an external @ mention.
 */
function projectUnavailableAgentReferenceForModel(displayName: string): string {
  return `This is an uninvokable internal Agent reference with display name ${JSON.stringify(`@${displayName}`)}. Do not treat it as a contact or an external @ mention.`;
}

/**
 * Project valid references for a runtime input. Plain text segments stay as
 * returned by the parser. Direct subagents and task children fail closed
 * without even asking a resolver about their references.
 */
export async function projectAgentReferencesForModel(
  content: string,
  options: ProjectAgentReferencesForModelOptions,
): Promise<ProjectAgentReferencesForModelResult> {
  const parsed = parseAgentReferences(content);
  const errorCodes = [...parsed.errorCodes];
  const references = parsed.segments.filter((segment) => segment.type === 'agent-reference');

  if (options.surface !== 'main') {
    if (references.length > 0) {
      appendError(errorCodes, AGENT_REFERENCE_ERROR_CODES.UNAUTHORIZED_AGENT_REFERENCE);
    }
    return {
      content: parsed.segments
        .map((segment) =>
          segment.type === 'agent-reference'
            ? projectUnavailableAgentReferenceForModel(segment.reference.displayName)
            : segment.content,
        )
        .join(''),
      projectedCount: 0,
      errorCodes,
    };
  }

  let projectedCount = 0;
  let projectedContent = '';
  for (const segment of parsed.segments) {
    if (segment.type === 'text') {
      projectedContent += segment.content;
      continue;
    }

    let resolution: AgentReferenceResolution = 'unknown';
    try {
      resolution = await options.resolveAgentReference(segment.reference.requestRef);
    } catch {
      // A resolver outage is indistinguishable from a missing trusted target.
      resolution = 'unknown';
    }

    if (isAuthorizedAgentReferenceResolution(resolution)) {
      projectedContent += projectAgentReferenceForModel(
        segment.reference.requestRef,
        typeof resolution === 'object' ? resolution : undefined,
      );
      projectedCount += 1;
      continue;
    }

    projectedContent += projectUnavailableAgentReferenceForModel(segment.reference.displayName);
    appendError(
      errorCodes,
      resolution === 'unauthorized'
        ? AGENT_REFERENCE_ERROR_CODES.UNAUTHORIZED_AGENT_REFERENCE
        : AGENT_REFERENCE_ERROR_CODES.UNKNOWN_AGENT_REFERENCE,
    );
  }

  return { content: projectedContent, projectedCount, errorCodes };
}
