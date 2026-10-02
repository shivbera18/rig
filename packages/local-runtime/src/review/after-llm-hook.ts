import type {
  PiAfterLlmCallHook,
  PiAfterLlmCallHookDecision,
} from '@rig/agent-core/pi-turn-runner';

import {
  applyReviewCandidateCorrections,
  finalizeReviewProjection,
  parseReviewCandidateCorrections,
  parseReviewCandidateText,
  projectReviewCandidates,
  type InvalidReviewFinding,
  type ReviewProjectionContext,
} from './candidates.js';
import {
  extractReviewCandidateText,
  hasReviewCandidateDocumentMarker,
} from './candidate-extraction.js';
import type { PreparedReview } from './preparation.js';
import type { ReviewTurnState } from './turn-state.js';
import type { ProjectedReviewAnnotation } from './types.js';
import {
  ReviewValidationObserver,
  type ReviewAssistantEventContext,
  type ReviewValidationObservabilityOptions,
} from './validation-observability.js';

export function createReviewAfterLlmHook(
  state: ReviewTurnState,
  observability: ReviewValidationObservabilityOptions = {},
): PiAfterLlmCallHook {
  const validation = new ReviewValidationObserver(observability);
  return async ({ message, sessionId, turnId, signal }) => {
    if (!state.isProjectionActive()) return { type: 'continue' };

    const subagentResult = state.getSubagentResult();
    if (subagentResult !== undefined) {
      state.finalize(subagentResult, 'needs_changes');
      return { type: 'replaceText', text: subagentResult };
    }

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const prepared = state.prepared;
    if (!prepared) return { type: 'continue' };
    const validationIdentity = { sessionId, turnId, prepared };
    const assistant = assistantEventContext(message, signal);

    const pending = state.getPendingProjection();
    if (
      text.trim().length === 0 &&
      (message.stopReason === 'error' || message.stopReason === 'aborted')
    ) {
      validation.recordIgnoredTerminalEmpty({
        ...validationIdentity,
        candidateText: text,
        assistant,
      });
      return { type: 'continue' };
    }
    if (message.content.some((block) => block.type === 'toolCall')) {
      return { type: 'continue' };
    }
    if (text.trim().length === 0) {
      validation.recordFailure({
        ...validationIdentity,
        stage: 'candidate',
        error: new Error('Review assistant response is empty'),
        candidateText: text,
        reasonCode: 'assistant_empty',
        assistant,
      });
      if (pending) {
        if (pending.annotations.length > 0) {
          validation.recordResult(validationIdentity, 'partial');
          return finalizeAcceptedFindings(state, prepared, pending.annotations);
        }
        validation.recordExhausted(validationIdentity);
        return invalidReviewFallback(state, prepared);
      }
      if (state.consumeInvalidCandidateRetry()) {
        return {
          type: 'retry',
          reason: 'review_candidate_missing',
          prompt: buildMissingCandidateRetryPrompt(prepared),
        };
      }
      validation.recordExhausted(validationIdentity);
      return invalidReviewFallback(state, prepared);
    }

    const candidateText = extractReviewCandidateText(text);
    if (pending) {
      if (candidateText === undefined) {
        validation.recordFailure({
          ...validationIdentity,
          stage: 'candidate',
          error: new Error('Review candidate correction XML is missing'),
          candidateText: text,
        });
        if (pending.annotations.length > 0) {
          validation.recordResult(validationIdentity, 'partial');
          return finalizeAcceptedFindings(state, prepared, pending.annotations);
        }
        validation.recordExhausted(validationIdentity);
        return invalidReviewFallback(state, prepared);
      }
      return handleCorrectionResponse({
        state,
        prepared,
        candidateText,
        validation,
        sessionId,
        turnId,
      });
    }

    if (candidateText === undefined) {
      validation.recordFailure({
        ...validationIdentity,
        stage: 'candidate',
        error: new Error('Review candidate XML is missing'),
        candidateText: text,
      });
      if (state.consumeInvalidCandidateRetry()) {
        return {
          type: 'retry',
          reason: 'review_candidate_missing',
          prompt: buildMissingCandidateRetryPrompt(prepared),
        };
      }
      validation.recordExhausted(validationIdentity);
      return invalidReviewFallback(state, prepared);
    }

    try {
      const candidates = parseReviewCandidateText(candidateText);
      if (candidates.verdict === 'pass') {
        validation.recordResult(validationIdentity);
        return finalizePassingReview(state, candidates.summary);
      }
      const partition = await projectReviewCandidates(candidates, projectionContext(prepared));
      if (partition.invalid.length === 0) {
        validation.recordResult(validationIdentity);
        return finalizeAcceptedFindings(state, prepared, partition.annotations, partition.summary);
      }
      validation.recordFailure({
        ...validationIdentity,
        stage: 'finding',
        error: new Error(partition.invalid.map((item) => item.diagnostic.message).join('; ')),
        candidateText,
        details: partition.invalid.map((item) => ({
          candidateKey: item.candidateKey,
          error: item.diagnostic.message,
        })),
      });
      if (state.consumeInvalidCandidateRetry()) {
        state.setPendingProjection(partition);
        return {
          type: 'retry',
          reason: 'review_candidate_invalid',
          prompt: buildFindingCorrectionPrompt(prepared, partition.invalid, state.delivery),
        };
      }
      if (partition.annotations.length > 0) {
        validation.recordResult(validationIdentity, 'partial');
        return finalizeAcceptedFindings(state, prepared, partition.annotations);
      }
      validation.recordExhausted(validationIdentity);
      return invalidReviewFallback(state, prepared);
    } catch (error) {
      validation.recordFailure({
        ...validationIdentity,
        stage: 'document',
        error,
        candidateText,
      });
      if (state.consumeInvalidCandidateRetry()) {
        return {
          type: 'retry',
          reason: 'review_candidate_invalid',
          prompt: buildDocumentRetryPrompt(prepared, error),
        };
      }
      validation.recordExhausted(validationIdentity);
      return invalidReviewFallback(state, prepared);
    }
  };
}

function assistantEventContext(
  message: Parameters<PiAfterLlmCallHook>[0]['message'],
  signal: AbortSignal | undefined,
): ReviewAssistantEventContext {
  return {
    stopReason: message.stopReason,
    ...(message.errorMessage !== undefined ? { errorMessage: message.errorMessage } : {}),
    ...(message.responseId !== undefined ? { responseId: message.responseId } : {}),
    ...(message.responseModel !== undefined ? { responseModel: message.responseModel } : {}),
    contentTypes: message.content.map((block) => block.type),
    ...(message.diagnostics !== undefined ? { diagnostics: message.diagnostics } : {}),
    signalAborted: signal?.aborted === true,
  };
}

async function handleCorrectionResponse(input: {
  state: ReviewTurnState;
  prepared: PreparedReview;
  candidateText: string;
  validation: ReviewValidationObserver;
  sessionId: string;
  turnId: string;
}): Promise<PiAfterLlmCallHookDecision> {
  const pending = input.state.getPendingProjection();
  if (!pending) return { type: 'continue' };

  try {
    if (hasReviewCandidateDocumentMarker(input.candidateText)) {
      const candidates = parseReviewCandidateText(input.candidateText);
      if (candidates.verdict === 'pass') {
        input.validation.recordResult({
          sessionId: input.sessionId,
          turnId: input.turnId,
          prepared: input.prepared,
        });
        return finalizePassingReview(input.state, candidates.summary);
      }
      const replacement = await projectReviewCandidates(
        candidates,
        projectionContext(input.prepared),
      );
      if (replacement.invalid.length > 0) {
        input.validation.recordFailure({
          sessionId: input.sessionId,
          turnId: input.turnId,
          prepared: input.prepared,
          stage: 'finding',
          error: new Error(replacement.invalid.map((item) => item.diagnostic.message).join('; ')),
          candidateText: input.candidateText,
          details: replacement.invalid.map((item) => ({
            candidateKey: item.candidateKey,
            error: item.diagnostic.message,
          })),
        });
      }
      if (replacement.annotations.length > 0) {
        input.validation.recordResult(
          { sessionId: input.sessionId, turnId: input.turnId, prepared: input.prepared },
          replacement.invalid.length > 0 ? 'partial' : undefined,
        );
        return finalizeAcceptedFindings(
          input.state,
          input.prepared,
          replacement.annotations,
          replacement.invalid.length === 0 ? replacement.summary : undefined,
        );
      }
      input.validation.recordExhausted({
        sessionId: input.sessionId,
        turnId: input.turnId,
        prepared: input.prepared,
      });
      return invalidReviewFallback(input.state, input.prepared);
    }

    const corrections = parseReviewCandidateCorrections(input.candidateText);
    const applied = await applyReviewCandidateCorrections(
      pending,
      corrections,
      projectionContext(input.prepared),
    );
    if (applied.failedCorrections > 0) {
      input.validation.recordFailure({
        sessionId: input.sessionId,
        turnId: input.turnId,
        prepared: input.prepared,
        stage: 'correction',
        error: new Error(`${applied.failedCorrections} review candidate corrections failed`),
        candidateText: input.candidateText,
        reasonCode: 'correction_application_failed',
      });
    }
    if (applied.annotations.length > 0) {
      const preservedEveryFinding =
        applied.explicitlyDropped === 0 && applied.failedCorrections === 0;
      input.validation.recordResult(
        { sessionId: input.sessionId, turnId: input.turnId, prepared: input.prepared },
        applied.explicitlyDropped > 0 || applied.failedCorrections > 0 ? 'partial' : undefined,
      );
      return finalizeAcceptedFindings(
        input.state,
        input.prepared,
        applied.annotations,
        preservedEveryFinding ? pending.summary : undefined,
      );
    }
    if (applied.failedCorrections === 0 && applied.explicitlyDropped === pending.invalid.length) {
      const conclusion = 'No reportable issues were found.';
      input.state.finalize(conclusion, 'pass');
      input.validation.recordResult(
        { sessionId: input.sessionId, turnId: input.turnId, prepared: input.prepared },
        applied.explicitlyDropped > 0 ? 'partial' : undefined,
      );
      return { type: 'replaceText', text: conclusion };
    }
    input.validation.recordExhausted({
      sessionId: input.sessionId,
      turnId: input.turnId,
      prepared: input.prepared,
    });
    return invalidReviewFallback(input.state, input.prepared);
  } catch (error) {
    input.validation.recordFailure({
      sessionId: input.sessionId,
      turnId: input.turnId,
      prepared: input.prepared,
      stage: 'correction',
      error,
      candidateText: input.candidateText,
    });
    if (pending.annotations.length > 0) {
      input.validation.recordResult(
        { sessionId: input.sessionId, turnId: input.turnId, prepared: input.prepared },
        'partial',
      );
      return finalizeAcceptedFindings(input.state, input.prepared, pending.annotations);
    }
    input.validation.recordExhausted({
      sessionId: input.sessionId,
      turnId: input.turnId,
      prepared: input.prepared,
    });
    return invalidReviewFallback(input.state, input.prepared);
  }
}

function finalizeAcceptedFindings(
  state: ReviewTurnState,
  prepared: PreparedReview,
  annotations: ProjectedReviewAnnotation[],
  summary?: string,
): PiAfterLlmCallHookDecision {
  const projected = finalizeReviewProjection({
    context: projectionContext(prepared),
    summary: summary ?? acceptedFindingSummary(prepared.responseLanguage, annotations.length),
    annotations,
  });
  state.finalize(projected.xml, 'needs_changes');
  return { type: 'replaceText' as const, text: projected.xml };
}

function invalidReviewFallback(
  state: ReviewTurnState,
  prepared: PreparedReview,
): PiAfterLlmCallHookDecision {
  const fallback = 'The model returned the code review result in an invalid format. Please retry.';
  state.finalize(fallback, 'failed');
  return { type: 'replaceText' as const, text: fallback };
}

function finalizePassingReview(
  state: ReviewTurnState,
  summary: string,
): PiAfterLlmCallHookDecision {
  state.finalize(summary, 'pass');
  return { type: 'replaceText', text: summary };
}

function acceptedFindingSummary(_language: 'zh-CN' | 'en', count: number): string {
  return `Found ${count} issue${count === 1 ? '' : 's'} that require attention.`;
}

function projectionContext(prepared: PreparedReview): ReviewProjectionContext {
  return {
    workspace: prepared.context.workspace,
    reviewRunId: prepared.context.reviewRunId,
    trigger: prepared.trigger,
    mode: prepared.mode,
    changedFiles: prepared.context.changedFiles,
  };
}

function buildFindingCorrectionPrompt(
  prepared: PreparedReview,
  invalid: InvalidReviewFinding[],
  delivery: ReviewTurnState['delivery'],
): string {
  const payload = invalid.map((item) =>
    delivery === 'git-discovery'
      ? {
          candidateKey: item.candidateKey,
          finding: item.finding,
          validationError: item.diagnostic.message,
        }
      : {
          candidateKey: item.candidateKey,
          finding: item.finding,
          validationError: item.diagnostic.message,
          changedRanges: item.diagnostic.changedRanges,
        },
  );
  const serialized = JSON.stringify(payload, null, 2);
  const discoveryInstruction =
    delivery === 'git-discovery'
      ? 'The precomputed change manifest was omitted. Inspect the current local Git diff to confirm each candidate file and line range; use action="drop" when a finding cannot be confirmed against the active diff.'
      : undefined;
  return [
    'The following code review candidates failed runtime location validation. Correct only these candidates; do not re-emit candidates that already passed validation.',
    'When the deletion itself is defective, target the corresponding deleted lines on the old side. When the comment belongs on surviving new-side code, use relatedChange to identify the local change that introduced the issue.',
    ...(discoveryInstruction ? [discoveryInstruction] : []),
    '',
    serialized,
    '',
    'Return exactly one <review-candidate-corrections version="1"> XML document. Copy each candidate-key exactly and use action="replace" with a corrected <finding>, or action="drop" for an issue that is not valid. Use ordinary XML text nodes for title and content. Escape & as &amp; first, then < as &lt; and > as &gt;; never emit a raw &, <, or > inside those text nodes. In XML attribute values, also escape " as &quot; and \' as &apos;. Do not add candidate keys or output Markdown or text outside the XML.',
  ].join('\n');
}

function buildDocumentRetryPrompt(prepared: PreparedReview, error: unknown): string {
  const detail = (error instanceof Error ? error.message : String(error)).replaceAll(
    prepared.context.workspace,
    '<workspace>',
  );
  const escapingChecklist = buildXmlEscapingRetryChecklist(prepared.responseLanguage);
  return `The review candidate XML could not be parsed or its top-level schema was invalid: ${detail}\nReturn exactly one corrected <review-candidates version="2"> XML document.\n${escapingChecklist}\nIf no reportable issues remain, return <review-candidates version="2" verdict="pass" />.`;
}

function buildXmlEscapingRetryChecklist(_language: 'zh-CN' | 'en'): string {
  return [
    'Apply this complete escaping checklist to the entire XML document, not only the location reported by the parser:',
    '- Ordinary text nodes (summary, title, content): write raw & as &amp;, raw < as &lt;, and raw > as &gt;.',
    '- XML attribute values: in addition to those three mappings, write raw double quotes as &quot; and raw single quotes as &apos;.',
    '- Escape only text and attribute values. Do not escape structural XML tags such as <review-candidates>, <finding>, <target>.',
    '- Code snippets, backtick-delimited text, and error messages follow the same rules; backticks do not exempt XML escaping.',
    '- Starting from raw text, escape & before < and >. Do not double-escape valid XML entities (&amp;, &lt;, &gt;, &quot;, &apos;).',
    '- Example: raw text x < 3 && y > 0 must be emitted as x &lt; 3 &amp;&amp; y &gt; 0.',
    '- Before returning, scan every summary, title, content, and attribute value for raw &, <, or >, and for raw quotes inside attributes.',
  ].join('\n');
}

function buildMissingCandidateRetryPrompt(_prepared: PreparedReview): string {
  return 'Code review must return candidate XML. Return exactly one <review-candidates version="2"> XML document. Use ordinary XML text nodes for summary, title, and content; escape & as &amp; before emitting XML. If no reportable issues remain, return <review-candidates version="2" verdict="pass" />.';
}
