import { describe, expect, it } from 'vitest';
import { DOCUMENT_STORAGE_KEYS as keys, GraphDocumentStorage } from '../src/document/documentStorage';
import { createGraphDocument, serializeGraphDocument } from '../src/document/graphDocument';

const doc = (value: number) => createGraphDocument({
  nodes: [{ id: 'value', label: 'Value', kind: 'value', baseValue: value }], edges: [],
});
const envelope = (revision: number, value: number) => JSON.stringify({
  version: 1, revision, payload: serializeGraphDocument(doc(value)),
});
const fallback = { nodes: [], edges: [] };

class FaultStorage {
  values = new Map<string, string>();
  operations = 0;
  failAt = Infinity;
  corruptKey = '';
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (++this.operations === this.failAt) throw new Error('Quota exceeded');
    this.values.set(key, key === this.corruptKey ? '{broken' : value);
  }
  removeItem(key: string) {
    if (++this.operations === this.failAt) throw new Error('Removal failed');
    this.values.delete(key);
  }
}

describe('recovery fault boundaries', () => {
  it('survives a denied localStorage getter and protects the fallback from saving', () => {
    const repository = new GraphDocumentStorage(() => { throw new Error('SecurityError'); });
    expect(repository.load(fallback)).toMatchObject({ source: 'fallback', saveBlocked: true });
    expect(() => repository.save(doc(1))).toThrow(/paused/);
  });

  it('recovers readable tiers after a partial access failure but blocks writes', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.lastGood, envelope(2, 2));
    const read = storage.getItem.bind(storage);
    storage.getItem = (key) => { if (key === keys.current) throw new Error('blocked'); return read(key); };
    const repository = new GraphDocumentStorage(storage);
    expect(repository.load(fallback)).toMatchObject({ document: doc(2), saveBlocked: true });
    expect(() => repository.save(doc(3))).toThrow();
    expect(storage.operations).toBe(0);
  });

  it('preserves all unrecoverable bytes instead of autosaving the fallback', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.temporary, '');
    const repository = new GraphDocumentStorage(storage);
    expect(repository.load(fallback).saveBlocked).toBe(true);
    expect(() => repository.save(doc(3))).toThrow();
    expect(storage.values.get(keys.temporary)).toBe('');
  });

  it('rejects external changes before writing, including same revision and storage clear', () => {
    for (const replacement of [envelope(1, 9), null]) {
      const storage = new FaultStorage();
      storage.values.set(keys.current, envelope(1, 1));
      const repository = new GraphDocumentStorage(storage);
      repository.load(fallback);
      if (replacement) storage.values.set(keys.current, replacement);
      else storage.values.clear();
      expect(() => repository.save(doc(2))).toThrow(/another tab/);
      expect(storage.operations).toBe(0);
    }
  });

  it('retries its own interrupted write with a higher revision', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, envelope(1, 1));
    const repository = new GraphDocumentStorage(storage);
    repository.load(fallback);
    storage.failAt = 3;
    expect(() => repository.save(doc(2))).toThrow();
    storage.failAt = Infinity;
    expect(repository.save(doc(3))).toBe(3);
    expect(repository.load(fallback).document).toEqual(doc(3));
    expect(JSON.parse(storage.getItem(keys.lastGood)!).payload).toBe(serializeGraphDocument(doc(2)));
  });

  it('breaks equal revision ties deterministically and rejects invalid revision metadata', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, envelope(2, 1));
    storage.values.set(keys.temporary, envelope(2, 2));
    expect(new GraphDocumentStorage(storage).load(fallback).document).toEqual(doc(1));
    for (const revision of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
      storage.values.set(keys.current, envelope(revision, 9));
      expect(new GraphDocumentStorage(storage).load(fallback).document).toEqual(doc(2));
    }
  });

  it.each([1, 2, 3, 4])('first save failure at step %i retains any written candidate', (failAt) => {
    const storage = new FaultStorage();
    const repository = new GraphDocumentStorage(storage);
    repository.load(fallback);
    storage.failAt = failAt;
    expect(() => repository.save(doc(1))).toThrow();
    const recovered = new GraphDocumentStorage(storage).load(fallback);
    expect(recovered.document).toEqual(failAt === 1 ? createGraphDocument(fallback) : doc(1));
  });

  it('refuses revision overflow before changing any bytes', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, envelope(Number.MAX_SAFE_INTEGER, 1));
    expect(() => new GraphDocumentStorage(storage).save(doc(2))).toThrow(/revision limit/);
    expect(storage.operations).toBe(0);
  });

  it('selects the newest valid revision, including temporary and last-good', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, envelope(2, 2));
    storage.values.set(keys.temporary, envelope(4, 4));
    storage.values.set(keys.lastGood, envelope(3, 3));
    expect(new GraphDocumentStorage(storage).load(fallback)).toMatchObject({
      document: doc(4), source: 'temporary', recovered: true,
    });
    storage.values.set(keys.lastGood, envelope(5, 5));
    expect(new GraphDocumentStorage(storage).load(fallback).document).toEqual(doc(5));
  });

  it('validates namespaces independently and does not compare their revisions', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, '{broken');
    storage.values.set('econgraph.document.v1.current', envelope(99, 99));
    expect(new GraphDocumentStorage(storage).load(fallback).document).toEqual(doc(99));
    storage.values.set(keys.lastGood, envelope(1, 1));
    expect(new GraphDocumentStorage(storage).load(fallback).document).toEqual(doc(1));
  });

  it('never writes while loading even malformed or interrupted records', () => {
    const storage = new FaultStorage();
    storage.values.set(keys.temporary, envelope(3, 3));
    const before = [...storage.values];
    new GraphDocumentStorage(storage).load(fallback);
    expect([...storage.values]).toEqual(before);
    expect(storage.operations).toBe(0);
  });

  it.each([1, 2, 3, 4])('retains latest recovered bytes when write step %i fails', (failAt) => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, envelope(1, 1));
    storage.values.set(keys.temporary, envelope(2, 2));
    const repository = new GraphDocumentStorage(storage);
    repository.load(fallback);
    storage.failAt = failAt;
    expect(() => repository.save(doc(3))).toThrow();
    const recovered = new GraphDocumentStorage(storage).load(fallback).document;
    expect([serializeGraphDocument(doc(2)), serializeGraphDocument(doc(3))])
      .toContain(serializeGraphDocument(recovered));
  });

  it.each([keys.lastGood, keys.temporary, keys.current])('rejects corrupt readback at %s without losing the recovered document', (key) => {
    const storage = new FaultStorage();
    storage.values.set(keys.current, envelope(1, 1));
    storage.values.set(keys.temporary, envelope(2, 2));
    const repository = new GraphDocumentStorage(storage);
    repository.load(fallback);
    storage.corruptKey = key;
    expect(() => repository.save(doc(3))).toThrow();
    const recovered = new GraphDocumentStorage(storage).load(fallback).document;
    expect([serializeGraphDocument(doc(2)), serializeGraphDocument(doc(3))])
      .toContain(serializeGraphDocument(recovered));
  });
});
