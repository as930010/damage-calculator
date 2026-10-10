import type { LoadoutState } from './state.ts';

export const DEFAULT_HISTORY_LIMIT = 50;

/**
 * The state is deliberately limited to the editable, serializable configuration.
 * The first timeline entry is the configuration restored at page startup, so the
 * history is session-only and never participates in persistence.
 */
function configurationSnapshot(state: LoadoutState): LoadoutState {
  const values = Object.fromEntries(
    Object.keys(state.values).sort().map(key => [key, state.values[key]]),
  ) as LoadoutState['values'];
  return { ...state, values };
}

export function serializeConfigurationSnapshot(state: LoadoutState): string {
  return JSON.stringify(configurationSnapshot(state));
}

export function configurationStatesEqual(left: LoadoutState, right: LoadoutState): boolean {
  return serializeConfigurationSnapshot(left) === serializeConfigurationSnapshot(right);
}

export type HistoryShortcutInput = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'isComposing'>;

/** Resolve supported shortcuts only when the user is outside an editable control. */
export function historyShortcutAction(event: HistoryShortcutInput, editableTarget: boolean): 'undo' | 'redo' | null {
  if (editableTarget || event.isComposing || event.altKey || !event.ctrlKey && !event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/** Bounded, in-memory timeline of complete user-editable configuration snapshots. */
export class LoadoutHistory {
  private snapshots: string[];
  private cursor = 0;
  readonly maxSteps: number;

  constructor(initialState: LoadoutState, maxSteps = DEFAULT_HISTORY_LIMIT) {
    if (!Number.isInteger(maxSteps) || maxSteps < 0) throw new RangeError('History limit must be a non-negative integer.');
    this.maxSteps = maxSteps;
    this.snapshots = [serializeConfigurationSnapshot(initialState)];
  }

  get canUndo(): boolean { return this.cursor > 0; }
  get canRedo(): boolean { return this.cursor < this.snapshots.length - 1; }
  get undoSteps(): number { return this.cursor; }
  get redoSteps(): number { return this.snapshots.length - this.cursor - 1; }
  get retainedSnapshots(): number { return this.snapshots.length; }
  /** Approximate retained UTF-16 string payload; engine object overhead is not included. */
  get approximateBytes(): number { return this.snapshots.reduce((total, value) => total + value.length * 2, 0); }

  /** Record one complete operation. Identical states are ignored; redo branches are discarded. */
  record(state: LoadoutState): boolean {
    const snapshot = serializeConfigurationSnapshot(state);
    if (snapshot === this.snapshots[this.cursor]) return false;
    this.snapshots.length = this.cursor + 1;
    this.snapshots.push(snapshot);
    this.cursor = this.snapshots.length - 1;
    if (this.snapshots.length > this.maxSteps + 1) {
      this.snapshots.shift();
      this.cursor -= 1;
    }
    return true;
  }

  undo(): LoadoutState | null {
    if (!this.canUndo) return null;
    this.cursor -= 1;
    return JSON.parse(this.snapshots[this.cursor]) as LoadoutState;
  }

  redo(): LoadoutState | null {
    if (!this.canRedo) return null;
    this.cursor += 1;
    return JSON.parse(this.snapshots[this.cursor]) as LoadoutState;
  }

  matches(state: LoadoutState): boolean {
    return serializeConfigurationSnapshot(state) === this.snapshots[this.cursor];
  }
}
