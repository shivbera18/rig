import type {
  RigBusinessTelemetry,
  RigBusinessEventMap,
  RigBusinessEventName,
  RigChatType,
  RigSlashCommandType,
} from './business-telemetry.js';
import { bucketRigDuration } from './business-telemetry.js';
import type { AutocompleteItem, AutocompleteSuggestions } from '../tui/widgets/autocomplete.js';

export interface TuiBusinessEventContext {
  readonly chatType: () => RigChatType;
  readonly userMessageCount: () => number;
  readonly skillCommandNames: () => ReadonlySet<string>;
}

export class TuiBusinessEventTracker {
  private readonly btwOpenedAtMs = new Map<string, number>();

  constructor(
    private readonly telemetry: RigBusinessTelemetry,
    private readonly context: TuiBusinessEventContext,
  ) {}

  trackBtwSessionOpened(input: {
    readonly parentSessionId: string;
    readonly sideSessionId: string;
  }): void {
    this.btwOpenedAtMs.set(input.sideSessionId, Date.now());
    this.track('btw_session_lifecycle', {
      phase: 'opened',
      duration_bucket: 'not_applicable',
      exit_reason: '',
    });
  }

  trackBtwSessionClosed(input: {
    readonly parentSessionId: string;
    readonly sideSessionId: string;
    readonly sideRunId?: string;
    readonly exitReason: 'ctrl_c' | 'ctrl_d' | 'navigation' | 'replaced';
  }): void {
    const openedAt = this.btwOpenedAtMs.get(input.sideSessionId);
    this.btwOpenedAtMs.delete(input.sideSessionId);
    this.track('btw_session_lifecycle', {
      phase: 'closed',
      duration_bucket: bucketRigDuration(
        openedAt === undefined ? 0 : Math.max(0, Date.now() - openedAt),
      ),
      exit_reason: input.exitReason,
    });
  }

  trackChatSend(input: {
    readonly attachmentCount: number;
    readonly isFirstMessage?: boolean;
  }): void {
    this.track('chat_send', {
      ...this.chatContext(),
      is_first_message: (input.isFirstMessage ?? this.context.userMessageCount() === 0) ? 1 : 0,
      is_attachment: input.attachmentCount > 0 ? 'attachment' : 'text',
    });
  }

  trackAutocompleteView(suggestions: AutocompleteSuggestions): void {
    if (suggestions.kind === 'argument') return;
    if (suggestions.prefix.startsWith('/')) {
      this.track('slash_command_menu_view', this.chatContext());
    } else if (suggestions.prefix.startsWith('@')) {
      this.track('at_command_menu_view', this.chatContext());
    }
  }

  trackAutocompleteSelection(suggestions: AutocompleteSuggestions, item: AutocompleteItem): void {
    if (suggestions.kind === 'argument') return;
    if (suggestions.prefix.startsWith('/')) {
      this.track('slash_command_click', {
        ...this.chatContext(),
        command_type: this.slashCommandType(item.value),
      });
    } else if (suggestions.prefix.startsWith('@')) {
      this.track('at_command_click', {
        ...this.chatContext(),
        command_type: item.label.endsWith('/') ? 'directory' : 'file',
      });
    }
  }

  private chatContext() {
    return {
      chat_type: this.context.chatType(),
    } as const;
  }

  private slashCommandType(commandName: string): RigSlashCommandType {
    const normalized = commandName.trim().toLocaleLowerCase();
    if (this.context.skillCommandNames().has(normalized)) return 'skill';
    if (normalized === 'new' || normalized === 'clear') return 'new_chat';
    if (normalized === 'compact') return 'summarize';
    if (normalized === 'plan') return 'plan_mode';
    if (normalized === 'goal') return 'goal_mode';
    return 'other';
  }

  private track<Event extends RigBusinessEventName>(
    event: Event,
    properties: RigBusinessEventMap[Event],
  ): void {
    try {
      this.telemetry.track(event, properties);
    } catch {
      // Business telemetry must not affect editor or submission behavior.
    }
  }
}
