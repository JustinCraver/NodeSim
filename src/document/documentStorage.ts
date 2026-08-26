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

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredEnvelope = {
  version: 1;
  revision: number;
  payload: string;
};

export type DocumentLoadResult = {
  document: GraphDocument;
  source: 'current' | 'temporary' | 'last-good' | 'fallback';
  recovered: boolean;
  warning?: string;
};

const parseEnvelope = (raw: string | null): { envelope: StoredEnvelope; document: GraphDocument } | undefined => {
  if (!raw) {
    return undefined;
  }
  try {
    const envelope = JSON.parse(raw) as Partial<StoredEnvelope>;
    if (
      envelope.version !== 1 ||
      typeof envelope.revision !== 'number' ||
      !Number.isSafeInteger(envelope.revision) ||
      envelope.revision < 1 ||
      typeof envelope.payload !== 'string'
    ) {
      return undefined;
    }
    return {
      envelope: envelope as StoredEnvelope,
      document: parseGraphDocumentText(envelope.payload),
    };
  } catch {
    return undefined;
  }
};

const serializeEnvelope = (envelope: StoredEnvelope) => JSON.stringify(envelope);

export class GraphDocumentStorage {
  constructor(private readonly storage: StorageLike) {}

  load(fallbackGraph: Parameters<typeof createGraphDocument>[0]): DocumentLoadResult {
    const currentRaw = this.storage.getItem(DOCUMENT_STORAGE_KEYS.current)
      ?? this.storage.getItem(LEGACY_DOCUMENT_STORAGE_KEYS.current);
    const current = parseEnvelope(currentRaw);
    if (current) {
      return { document: current.document, source: 'current', recovered: false };
    }

    const temporary = parseEnvelope(
      this.storage.getItem(DOCUMENT_STORAGE_KEYS.temporary)
        ?? this.storage.getItem(LEGACY_DOCUMENT_STORAGE_KEYS.temporary),
    );
    if (temporary) {
      return {
        document: temporary.document,
        source: 'temporary',
        recovered: true,
        warning: currentRaw
          ? 'The saved document was invalid; recovered an interrupted valid write.'
          : 'Recovered an interrupted valid write.',
      };
    }

    const lastGood = parseEnvelope(
      this.storage.getItem(DOCUMENT_STORAGE_KEYS.lastGood)
        ?? this.storage.getItem(LEGACY_DOCUMENT_STORAGE_KEYS.lastGood),
    );
    if (lastGood) {
      return {
        document: lastGood.document,
        source: 'last-good',
        recovered: true,
        warning: 'The saved document was invalid; recovered the last-known-good document.',
      };
    }

    return {
      document: createGraphDocument(fallbackGraph),
      source: 'fallback',
      recovered: Boolean(currentRaw),
      ...(currentRaw ? { warning: 'No valid saved document was recoverable; loaded the demo.' } : {}),
    };
  }

  save(document: GraphDocument) {
    const payload = serializeGraphDocument(migrateGraphDocument(document));
    const currentRaw = this.storage.getItem(DOCUMENT_STORAGE_KEYS.current);
    const current = parseEnvelope(currentRaw);
    const lastGood = parseEnvelope(this.storage.getItem(DOCUMENT_STORAGE_KEYS.lastGood));
    const revision = Math.max(current?.envelope.revision ?? 0, lastGood?.envelope.revision ?? 0) + 1;
    const envelope: StoredEnvelope = { version: 1, revision, payload };
    const serialized = serializeEnvelope(envelope);

    this.storage.setItem(DOCUMENT_STORAGE_KEYS.temporary, serialized);
    const verifiedTemporary = parseEnvelope(this.storage.getItem(DOCUMENT_STORAGE_KEYS.temporary));
    if (!verifiedTemporary || verifiedTemporary.envelope.payload !== payload) {
      throw new Error('Temporary autosave readback validation failed');
    }

    if (currentRaw && current) {
      this.storage.setItem(DOCUMENT_STORAGE_KEYS.lastGood, currentRaw);
    }
    this.storage.setItem(DOCUMENT_STORAGE_KEYS.current, serialized);
    const verifiedCurrent = parseEnvelope(this.storage.getItem(DOCUMENT_STORAGE_KEYS.current));
    if (!verifiedCurrent || verifiedCurrent.envelope.payload !== payload) {
      throw new Error('Autosave replacement readback validation failed');
    }
    if (!currentRaw) {
      this.storage.setItem(DOCUMENT_STORAGE_KEYS.lastGood, serialized);
    }
    this.storage.removeItem(DOCUMENT_STORAGE_KEYS.temporary);
    return revision;
  }

  rememberLegacyImport(text: string) {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !('schemaVersion' in parsed)) {
      this.storage.setItem(DOCUMENT_STORAGE_KEYS.legacyImport, text);
    }
  }
}
