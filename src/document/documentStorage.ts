import type { GraphDocument } from '../models/types';
import {
  createGraphDocument,
  migrateGraphDocument,
  parseGraphDocumentText,
  serializeGraphDocument,
} from './graphDocument';

export const DOCUMENT_STORAGE_KEYS = {
  current: 'nodesim.document.v1.current',
  lastGood: 'nodesim.document.v1.last-good',
  temporary: 'nodesim.document.v1.temporary',
  legacyImport: 'nodesim.document.v1.legacy-import',
} as const;

const LEGACY_DOCUMENT_STORAGE_KEYS = {
  current: 'econgraph.document.v1.current',
  lastGood: 'econgraph.document.v1.last-good',
  temporary: 'econgraph.document.v1.temporary',
} as const;
const tiers = ['current', 'temporary', 'lastGood'] as const;
const recordKeys: string[] = [DOCUMENT_STORAGE_KEYS, LEGACY_DOCUMENT_STORAGE_KEYS]
  .flatMap((namespace) => tiers.map((tier) => namespace[tier]));
export const isDocumentStorageKey = (key: string | null) => key === null || recordKeys.includes(key);

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StoredEnvelope = { version: 1; revision: number; payload: string };
type Records = Map<string, string | null>;
export type DocumentLoadResult = {
  document: GraphDocument;
  source: 'current' | 'temporary' | 'last-good' | 'fallback';
  recovered: boolean;
  saveBlocked: boolean;
  warning?: string;
};

export class StorageConflictError extends Error {
  constructor() { super('Saved data changed in another tab. Autosave is paused; export your edits or load the saved version.'); }
}

const parseEnvelope = (raw: string | null) => {
  if (!raw) return undefined;
  try {
    const envelope = JSON.parse(raw) as Partial<StoredEnvelope>;
    if (envelope.version !== 1 || !Number.isSafeInteger(envelope.revision) ||
      (envelope.revision ?? 0) < 1 || typeof envelope.payload !== 'string') return undefined;
    return { envelope: envelope as StoredEnvelope, document: parseGraphDocumentText(envelope.payload) };
  } catch {
    return undefined;
  }
};

// Revisions belong to their namespace. Prefer valid NodeSim data, then legacy;
// within a namespace take the highest revision, ties current > temp > good.
const selectCandidate = (records: Records) => {
  for (const namespace of [DOCUMENT_STORAGE_KEYS, LEGACY_DOCUMENT_STORAGE_KEYS]) {
    const candidates = tiers.flatMap((tier) => {
      const raw = records.get(namespace[tier]) ?? null;
      const parsed = parseEnvelope(raw);
      return parsed && raw !== null ? [{ ...parsed, raw, tier }] : [];
    });
    candidates.sort((a, b) => b.envelope.revision - a.envelope.revision);
    if (candidates.length) return candidates[0];
  }
  return undefined;
};

export class GraphDocumentStorage {
  // null protects unreadable/unrecoverable bytes from a fallback demo save.
  // undefined supports non-browser callers saving before loading.
  private baseline: Records | null | undefined;
  constructor(private readonly source: StorageLike | (() => StorageLike)) {}
  private get storage() { return typeof this.source === 'function' ? this.source() : this.source; }

  private readRecords() {
    const records: Records = new Map();
    let unavailable = false;
    for (const key of recordKeys) {
      try { records.set(key, this.storage.getItem(key)); }
      catch { unavailable = true; }
    }
    return { records, unavailable };
  }

  load(fallbackGraph: Parameters<typeof createGraphDocument>[0]): DocumentLoadResult {
    const { records, unavailable } = this.readRecords();
    const selected = selectCandidate(records);
    const hasBytes = [...records.values()].some((raw) => raw !== null);
    const saveBlocked = unavailable || (!selected && hasBytes);
    this.baseline = saveBlocked ? null : records;
    const source = selected?.tier === 'lastGood' ? 'last-good' : selected?.tier ?? 'fallback';
    const recovered = selected ? source !== 'current' : hasBytes;
    const warning = unavailable
      ? 'Browser storage could not be read completely. Autosave is paused. You can edit and export; load saved data when storage is available.'
      : !selected && hasBytes
        ? 'No valid saved document was recoverable. The demo is open; autosave is paused to preserve the original bytes. You can edit and export.'
        : recovered ? `Recovered the newest valid ${source} document. Original records are retained until your next edit.` : undefined;
    return {
      document: selected?.document ?? createGraphDocument(fallbackGraph),
      source, recovered, saveBlocked, warning,
    };
  }

  assertUnchanged() {
    if (this.baseline === null) throw new Error('Autosave is paused to protect unreadable saved data. Load saved data before resuming.');
    const { records, unavailable } = this.readRecords();
    if (unavailable) throw new Error('Browser storage is unavailable. Your changes are still unsaved; export a copy.');
    if (this.baseline === undefined) {
      if (!selectCandidate(records) && [...records.values()].some((raw) => raw !== null)) {
        this.baseline = null;
        throw new Error('Unrecoverable saved data must be preserved.');
      }
      this.baseline = records;
    }
    if (recordKeys.some((key) => records.get(key) !== this.baseline?.get(key))) throw new StorageConflictError();
    return records;
  }

  // Browser callers serialize this synchronous transaction with a Web Lock.
  // Comparing records alone cannot prevent simultaneous cross-tab writes.
  save(document: GraphDocument) {
    const payload = serializeGraphDocument(migrateGraphDocument(document));
    const records = this.assertUnchanged();
    const selected = selectCandidate(records);
    const revision = (selected?.envelope.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Storage revision limit reached. Export your document.');
    const serialized = JSON.stringify({ version: 1, revision, payload });
    const writeVerified = (key: string, raw: string) => {
      this.storage.setItem(key, raw);
      this.baseline?.set(key, raw);
      if (this.storage.getItem(key) !== raw) throw new Error('Autosave readback validation failed. Your changes are still unsaved.');
    };

    // Protect a newer temporary record BEFORE reusing the temporary slot.
    if (selected && records.get(DOCUMENT_STORAGE_KEYS.lastGood) !== selected.raw) {
      writeVerified(DOCUMENT_STORAGE_KEYS.lastGood, selected.raw);
    }
    writeVerified(DOCUMENT_STORAGE_KEYS.temporary, serialized);
    writeVerified(DOCUMENT_STORAGE_KEYS.current, serialized);
    if (!selected) writeVerified(DOCUMENT_STORAGE_KEYS.lastGood, serialized);
    this.storage.removeItem(DOCUMENT_STORAGE_KEYS.temporary);
    this.baseline?.set(DOCUMENT_STORAGE_KEYS.temporary, null);
    return revision;
  }

  rememberLegacyImport(text: string) {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !('schemaVersion' in parsed)) {
      this.storage.setItem(DOCUMENT_STORAGE_KEYS.legacyImport, text);
    }
  }
}
