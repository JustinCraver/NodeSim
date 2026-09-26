import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutosaveSession, type ExclusiveWrite } from '../src/document/autosaveSession';
import { GraphDocumentStorage } from '../src/document/documentStorage';
import { createGraphDocument } from '../src/document/graphDocument';

const fallback = { nodes: [], edges: [] };
const doc = (nodeScale: number) => createGraphDocument({ ...fallback, nodeScale });
const setup = (exclusive: ExclusiveWrite = async (action) => { action(); }) => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const repository = new GraphDocumentStorage(storage);
  const initial = repository.load(fallback);
  const publish = vi.fn();
  const session = new AutosaveSession(repository, exclusive, publish, initial);
  return { session, repository, storage, publish };
};
afterEach(() => { vi.useRealTimers(); });

describe('authored pending edits and competing tabs', () => {
  it('debounces and saves the latest accepted transaction', async () => {
    vi.useFakeTimers();
    const { session, repository } = setup();
    session.edit(doc(1));
    await vi.advanceTimersByTimeAsync(200);
    session.edit(doc(2));
    await vi.advanceTimersByTimeAsync(249);
    expect(session.getSnapshot().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getSnapshot()).toMatchObject({ dirty: false, savedRevision: 1 });
    expect(repository.load(fallback).document).toEqual(doc(2));
    session.dispose();
  });

  it('flushes immediately before debounce and uses edits made while waiting for the lock', async () => {
    let release = () => {};
    const { session, repository } = setup((action) => new Promise<void>((resolve) => {
      release = () => { action(); resolve(); };
    }));
    session.edit(doc(1));
    const saving = session.flush();
    session.edit(doc(2));
    expect(session.getSnapshot()).toMatchObject({ dirty: true, saving: true });
    release();
    await saving;
    expect(repository.load(fallback).document).toEqual(doc(2));
    expect(session.getSnapshot().dirty).toBe(false);
    session.dispose();
  });

  it('keeps dirty state on quota failure and clears it only after a successful retry', async () => {
    const { session, storage } = setup();
    const write = storage.setItem;
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    session.edit(doc(1));
    await session.flush();
    expect(session.getSnapshot()).toMatchObject({ dirty: true, saving: false });
    expect(session.getSnapshot().warning).toContain('Changes remain unsaved');
    storage.setItem = write;
    await session.flush();
    expect(session.getSnapshot()).toMatchObject({ dirty: false, warning: undefined });
    session.dispose();
  });

  it('serializes simultaneous tab writes and pauses the loser without changing its pending document', async () => {
    let queue = Promise.resolve();
    const exclusive: ExclusiveWrite = (action) => {
      const result = queue.then(action);
      queue = result.catch(() => {});
      return result;
    };
    const first = setup(exclusive);
    const repository = new GraphDocumentStorage(first.storage);
    const second = new AutosaveSession(repository, exclusive, () => {}, repository.load(fallback));
    first.session.edit(doc(1));
    second.edit(doc(2));
    await Promise.all([first.session.flush(), second.flush()]);
    expect(second.getSnapshot()).toMatchObject({ dirty: true, paused: true });
    expect(first.repository.load(fallback).document).toEqual(doc(1));
    second.edit(doc(3));
    await second.flush();
    expect(first.repository.load(fallback).document).toEqual(doc(1));
    let applied;
    await second.loadSaved(fallback, (document) => { applied = document; second.edit(document); });
    expect(applied).toEqual(doc(1));
    expect(second.getSnapshot()).toMatchObject({ dirty: false, paused: false });
    second.edit(doc(4));
    await second.flush();
    await first.session.checkForConflict();
    expect(first.session.getSnapshot().paused).toBe(true);
    expect(repository.load(fallback).document).toEqual(doc(4));
    first.session.dispose(); second.dispose();
  });

  it('does not replace local work when explicit reload still cannot read storage', async () => {
    const { session, storage } = setup();
    session.edit(doc(2));
    storage.getItem = () => { throw new Error('blocked'); };
    const apply = vi.fn();
    await session.loadSaved(fallback, apply);
    expect(apply).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ dirty: true, paused: true });
    session.dispose();
  });

  it('cancels timers and queued saves when disposed, without callbacks after cleanup', async () => {
    let release = () => {};
    const { session, publish, repository } = setup((action) => new Promise<void>((resolve) => {
      release = () => { action(); resolve(); };
    }));
    session.edit(doc(2));
    const saving = session.flush();
    session.dispose();
    publish.mockClear();
    release();
    await saving;
    expect(publish).not.toHaveBeenCalled();
    expect(repository.load(fallback).source).toBe('fallback');
  });
});
