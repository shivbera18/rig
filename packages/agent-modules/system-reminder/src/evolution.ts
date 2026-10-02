/**
 * Evolution reminder logic — memory write prompts.
 *
 * v3: skill crystallization in-turn reminder removed. Skill reflection moved
 * to the daily-digest session-end fallback re-prompt (see
 * `daily-digest.ts:runSessionLevelFallback`) and the 05:00 memory-cleanup
 * spawn (multi-session pattern detection). The state map signatures still
 * carry `lastSkillReminderAt` / `nextSkillReminderAt` / `skillReminderGap`
 * so external callers compile during the rename window — they're unused
 * by this function in v3.
 *
 * Migrated from legacy prompt transform.
 * State (counters, snapshots) lives on SystemReminderService instance fields.
 */

import type { MemoryDirSnapshot } from './types.js';
import { EVOLUTION_CONFIG } from './types.js';

// ─── Bound helpers ───────────────────────────────────────────────────────────

const MAX_MAP_SIZE = 200;

/** Evict oldest entries when a Map exceeds the size bound. */
export function boundMap<K, V>(map: Map<K, V>, max = MAX_MAP_SIZE): void {
  if (map.size <= max) return;
  const keysToDelete = [...map.keys()].slice(0, map.size - max);
  for (const key of keysToDelete) {
    map.delete(key);
  }
}

// ─── Evolution Reminder ──────────────────────────────────────────────────────

export interface EvolutionState {
  memorySnapshots: Map<string, MemoryDirSnapshot>;
  /** @deprecated v3: skill in-turn reminder removed. Field kept so existing
   * SystemReminderService field declarations compile; not read by
   * `getEvolutionReminder` anymore. */
  lastSkillReminderAt: Map<string, number>;
  /** Next turn at which to fire memory reminder (exponential back-off). */
  nextMemoryReminderAt: Map<string, number>;
  /** Current back-off gap for memory reminder (doubles on each miss). */
  memoryReminderGap: Map<string, number>;
  /** @deprecated v3: skill in-turn reminder removed. */
  nextSkillReminderAt: Map<string, number>;
  /** @deprecated v3: skill in-turn reminder removed. */
  skillReminderGap: Map<string, number>;
}

/**
 * Check evolution conditions and return reminder text if needed.
 *
 * v3: only the memory write reminder remains. Schedule:
 *   - First fires at turn INITIAL_INTERVAL (10)
 *   - If ignored, gap doubles: 10 → 20 → 40 (capped at MAX)
 *   - Preserves backoff pace when agent writes memory (only snapshot updated)
 *
 * Skill crystallization reminder removed — skill reflection now happens at
 * session end via the daily-digest fallback re-prompt and at 05:00 via the
 * memory-cleanup multi-session pattern scan.
 *
 * @param currentMemorySnapshot - Host-collected snapshot of agent-level memory files
 * @param sessionId - Current session ID
 * @param agentName - Agent name (for rig memory commands)
 * @param turnCount - Current turn number (1-indexed, from service layer)
 * @param state - Mutable state maps (owned by SystemReminderService)
 * @returns Reminder text or undefined
 */
export function getEvolutionReminder(
  currentMemorySnapshot: MemoryDirSnapshot | undefined,
  sessionId: string,
  _agentName: string,
  turnCount: number,
  state: EvolutionState,
): string | undefined {
  if (!currentMemorySnapshot) return undefined;

  // Take initial snapshot on first call (agent memory dir — session memory removed)
  if (!state.memorySnapshots.has(sessionId)) {
    state.memorySnapshots.set(sessionId, cloneMemorySnapshot(currentMemorySnapshot));
    boundMap(state.memorySnapshots);
  }

  const reminders: string[] = [];

  // ── Memory reminder with exponential back-off ──
  const nextAt =
    state.nextMemoryReminderAt.get(sessionId) ?? EVOLUTION_CONFIG.MEMORY_REMINDER_INITIAL_INTERVAL;
  const currentGap =
    state.memoryReminderGap.get(sessionId) ?? EVOLUTION_CONFIG.MEMORY_REMINDER_INITIAL_INTERVAL;

  // Compaction detection: if turnCount dropped below the last fire point
  // (context was compressed), reset the back-off schedule.
  const lastFiredAt = nextAt - currentGap;
  if (lastFiredAt > 0 && turnCount < lastFiredAt) {
    state.nextMemoryReminderAt.set(
      sessionId,
      turnCount + EVOLUTION_CONFIG.MEMORY_REMINDER_INITIAL_INTERVAL,
    );
    state.memoryReminderGap.set(sessionId, EVOLUTION_CONFIG.MEMORY_REMINDER_INITIAL_INTERVAL);
  }

  const effectiveNextAt =
    state.nextMemoryReminderAt.get(sessionId) ?? EVOLUTION_CONFIG.MEMORY_REMINDER_INITIAL_INTERVAL;

  if (turnCount >= effectiveNextAt) {
    const initial = state.memorySnapshots.get(sessionId)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    const current = currentMemorySnapshot;
    const memoryChanged =
      current.maxMtime > initial.maxMtime || current.files.length > initial.files.length;
    const activeGap =
      state.memoryReminderGap.get(sessionId) ?? EVOLUTION_CONFIG.MEMORY_REMINDER_INITIAL_INTERVAL;

    if (!memoryChanged) {
      // Double the gap, capped at MAX
      const nextGap = Math.min(activeGap * 2, EVOLUTION_CONFIG.MEMORY_REMINDER_MAX_INTERVAL);
      state.memoryReminderGap.set(sessionId, nextGap);
      state.nextMemoryReminderAt.set(sessionId, turnCount + nextGap);
      boundMap(state.memoryReminderGap);
      boundMap(state.nextMemoryReminderAt);

      reminders.push(
        [
          `Worked ${turnCount} turns, check if there is anything worth remembering.`,
          '',
          'Ask yourself: did this session learn lessons where **not checking memory would repeat the mistake next time**?',
          '',
          'Before writing, apply the three-question test to determine the tier (write to the first matching layer, do not default to agent memory):',
          '  1. Different user changes it? → **User memory** (e.g., MR merge preference, communication style, numbering habits)',
          '  2. Different project but conclusion holds? → **Agent memory** (e.g., CI debugging tips, use .zshenv for non-interactive shell)',
          '  3. Holds only in current project? → **Project memory** AGENTS.md / topic file (e.g., MR target dev, chat group ID)',
          '',
          'Nothing new? Writing nothing is completely fine, not every session produces new knowledge.',
          '',
          'Do NOT write: code structure, git history, API schemas, information found in existing docs.',
          'If you have not read the `rig-memory` skill yet, load it before writing — it has complete layering rules and exclusions.',
        ].join('\n'),
      );
    } else {
      // Memory was written — update baseline snapshot and advance schedule
      // by current gap (no reset to initial — backoff pace is preserved).
      state.memorySnapshots.set(sessionId, cloneMemorySnapshot(current));
      state.nextMemoryReminderAt.set(sessionId, turnCount + activeGap);
      boundMap(state.memorySnapshots);
      boundMap(state.nextMemoryReminderAt);
    }
  }

  return reminders.length > 0 ? reminders.join('\n\n---\n\n') : undefined;
}

function cloneMemorySnapshot(snapshot: MemoryDirSnapshot): MemoryDirSnapshot {
  return { files: [...snapshot.files], maxMtime: snapshot.maxMtime };
}
