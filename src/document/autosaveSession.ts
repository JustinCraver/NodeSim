import type { GraphData, GraphDocument } from '../models/types';
import { GraphDocumentStorage, StorageConflictError, type DocumentLoadResult } from './documentStorage';

export const AUTOSAVE_DEBOUNCE_MS = 250;
export const DOCUMENT_WRITE_LOCK = 'nodesim.document.v1.write';
export type ExclusiveWrite = (action: () => void) => Promise<void>;
export type AutosaveState = {
  dirty: boolean;
  saving: boolean;
  paused: boolean;
  warning?: string;
  savedRevision?: number;
};

// Keeps pending authored edits independent of React render timing. Browser
// adapters supply Web Locks; tests can deterministically hold or release a lock.
export class AutosaveSession {
  private state: AutosaveState;
  private pending?: GraphDocument;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private readonly repository: GraphDocumentStorage,
    private readonly exclusive: ExclusiveWrite,
    private readonly publish: (state: AutosaveState) => void,
    initial: Pick<DocumentLoadResult, 'saveBlocked' | 'warning'>,
  ) {
    this.state = { dirty: false, saving: false, paused: initial.saveBlocked, warning: initial.warning };
  }

  getSnapshot() { return this.state; }
  private update(changes: Partial<AutosaveState>) {
    this.state = { ...this.state, ...changes };
    if (!this.disposed) this.publish(this.state);
  }
  private clearTimer() { clearTimeout(this.timer); this.timer = undefined; }
  private failed(error: unknown) {
    const detail = error instanceof Error ? error.message : 'Browser storage failed.';
    this.update({
      saving: false,
      paused: this.state.paused || error instanceof StorageConflictError,
      warning: error instanceof StorageConflictError ? detail
        : `Autosave unavailable: ${detail} ${this.state.dirty ? 'Changes remain unsaved. Export a copy or retry.' : 'You can keep editing and export a copy.'}`,
    });
  }

  edit(document: GraphDocument) {
    this.pending = document;
    this.update({ dirty: true });
    this.clearTimer();
    if (!this.state.paused) this.timer = setTimeout(() => { void this.flush(); }, AUTOSAVE_DEBOUNCE_MS);
  }

  async flush() {
    this.clearTimer();
    if (this.disposed || !this.pending || this.state.paused || this.state.saving) return;
    this.update({ saving: true });
    try {
      await this.exclusive(() => {
        if (this.disposed || !this.pending || this.state.paused) return;
        const revision = this.repository.save(this.pending);
        this.pending = undefined;
        this.update({ dirty: false, saving: false, warning: undefined, savedRevision: revision });
      });
      if (!this.disposed) this.update({ saving: false });
    } catch (error) {
      if (!this.disposed) this.failed(error);
    }
  }

  async checkForConflict() {
    if (this.disposed || this.state.paused) return;
    try {
      // Do not interpret another tab's intermediate write stages as a conflict.
      await this.exclusive(() => { if (!this.disposed) this.repository.assertUnchanged(); });
    } catch (error) {
      if (!this.disposed) this.failed(error);
    }
  }

  async loadSaved(fallback: GraphData, apply: (document: GraphDocument) => void) {
    try {
      await this.exclusive(() => {
        if (this.disposed) return;
        const loaded = this.repository.load(fallback);
        if (loaded.saveBlocked) {
          this.update({ paused: true, warning: loaded.warning });
          return;
        }
        apply(loaded.document);
        this.clearTimer();
        this.pending = undefined;
        this.update({ dirty: false, saving: false, paused: false, warning: loaded.warning, savedRevision: undefined });
      });
    } catch (error) {
      if (!this.disposed) this.failed(error);
    }
  }

  dispose() { this.disposed = true; this.clearTimer(); }
}

export const browserExclusiveWrite: ExclusiveWrite = async (action) => {
  if (!navigator.locks) throw new Error('Safe autosave requires browser Web Locks. You can keep editing and export with Save.');
  await navigator.locks.request(DOCUMENT_WRITE_LOCK, action);
};
