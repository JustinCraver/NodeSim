import { describe, expect, it } from 'vitest';
import demoGraph from '../src/demo/houseFund.json';
import { DOCUMENT_STORAGE_KEYS, GraphDocumentStorage } from '../src/document/documentStorage';
import {
  DEFAULT_SIMULATION_SETTINGS,
  createGraphDocument,
  graphDocumentToRuntimeGraph,
  mergeCustomGraphIntoRoot,
  migrateGraphDocument,
  parseGraphDocumentText,
  serializeGraphDocument,
} from '../src/document/graphDocument';
import type { GraphData, GraphDocument } from '../src/models/types';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const legacyDemo = demoGraph as GraphData;

describe('versioned GraphDocument migration and serialization', () => {
  it('migrates the legacy demo deterministically with Stage 4 defaults', () => {
    const first = migrateGraphDocument(structuredClone(legacyDemo));
    const second = migrateGraphDocument(structuredClone(legacyDemo));

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(1);
    expect(first.settings.simulation).toEqual(DEFAULT_SIMULATION_SETTINGS);
    expect(first.graph.edges.every((edge) => edge.weight === 1 && edge.lagMonths === 0)).toBe(true);
    expect(first.graph.nodes.find((node) => node.id === 'monthlySavings')).toMatchObject({
      kind: 'calc',
      outputType: 'monthly-flow',
    });
    expect(first.graph.nodes.find((node) => node.id === 'houseFund')).toMatchObject({
      kind: 'asset',
      initialBalance: 0,
    });
    expect(first.graph.edges.find((edge) => edge.id === 'edge-asset-output')?.sourcePort).toBe('balance');
  });

  it('whitelists authored fields and strips derived state at every graph depth', () => {
    const runtime = structuredClone(legacyDemo);
    runtime.nodes[0].computedValue = 4_000;
    runtime.nodes[0].timeseries = [4_000];
    runtime.nodes[0].input1Connected = true;
    const custom = runtime.nodes.find((node) => node.kind === 'custom')?.custom;
    if (!custom) {
      throw new Error('Expected demo custom node');
    }
    custom.internalGraph.nodes[0].computedValue = 10;

    const serialized = serializeGraphDocument(createGraphDocument(runtime));

    expect(serialized).not.toContain('computedValue');
    expect(serialized).not.toContain('timeseries');
    expect(serialized).not.toContain('input1Connected');
    expect(parseGraphDocumentText(serialized)).toEqual(JSON.parse(serialized));
  });

  it('exports the same complete root document from main and custom views', () => {
    const root = graphDocumentToRuntimeGraph(migrateGraphDocument(legacyDemo));
    const customNode = root.nodes.find((node) => node.id === 'savingsAdjuster');
    if (customNode?.kind !== 'custom' || !customNode.custom) {
      throw new Error('Expected savings adjuster');
    }
    const editedInternal = structuredClone(customNode.custom.internalGraph);
    editedInternal.nodes[0].label = 'Edited inside custom view';
    const mergedRoot = mergeCustomGraphIntoRoot(root, customNode.id, editedInternal);

    const customViewExport = createGraphDocument(
      mergeCustomGraphIntoRoot(root, customNode.id, editedInternal),
      DEFAULT_SIMULATION_SETTINGS,
    );
    const mainViewExport = createGraphDocument(mergedRoot, DEFAULT_SIMULATION_SETTINGS);

    expect(customViewExport).toEqual(mainViewExport);
    expect(customViewExport.graph.nodes).toHaveLength(root.nodes.length);
    const exportedCustom = customViewExport.graph.nodes.find((node) => node.id === customNode.id);
    expect(exportedCustom?.kind === 'custom' ? exportedCustom.custom.internalGraph.nodes[0].label : '').toBe(
      'Edited inside custom view',
    );
  });

  it('maps an unported legacy multi-output edge to the first output and assigns formula-safe identities', () => {
    const legacy: GraphData = {
      nodes: [
        {
          id: 'custom',
          label: 'Custom',
          kind: 'custom',
          custom: {
            inputs: [{ id: 'in-1', label: 'Input' }],
            outputs: [
              { id: 'out-one', label: 'One' },
              { id: 'out-two', label: 'Two' },
            ],
            internalGraph: {
              nodes: [
                { id: 'input', label: 'Input', kind: 'value', baseValue: 0 },
                { id: 'one', label: 'One', kind: 'value', baseValue: 1 },
                { id: 'two', label: 'Two', kind: 'value', baseValue: 2 },
              ],
              edges: [],
            },
            inputBindings: { 'in-1': 'input' },
            outputBindings: { 'out-one': 'one', 'out-two': 'two' },
          },
        },
        { id: 'sink', label: 'Sink', kind: 'value', baseValue: 0 },
      ],
      edges: [
        { id: 'legacy-edge', source: 'custom', target: 'sink', kind: 'flow' },
      ],
    };

    const migrated = migrateGraphDocument(legacy);
    const custom = migrated.graph.nodes[0];

    expect(migrated.graph.edges[0].sourcePort).toBe('out-one');
    expect(custom.kind === 'custom' ? custom.custom.outputs.map((port) => port.formulaId) : []).toEqual([
      'out_one',
      'out_two',
    ]);
  });

  it('rewrites a legacy asset formula reference to its migrated named output', () => {
    const legacy: GraphData = {
      nodes: [
        { id: 'asset', label: 'Asset', kind: 'asset', interestRateAnnual: 0 },
        { id: 'calc', label: 'Calc', kind: 'calc', formula: 'asset + 1' },
      ],
      edges: [{ id: 'asset-calc', source: 'asset', target: 'calc', kind: 'flow' }],
    };

    const migrated = migrateGraphDocument(legacy);
    const calc = migrated.graph.nodes.find((node) => node.id === 'calc');

    expect(migrated.graph.edges[0].sourcePort).toBe('endingBalance');
    expect(calc?.kind === 'calc' ? calc.formula : '').toBe('asset.endingBalance + 1');
  });

  it('reports an exact path and leaves the active document untouched on invalid import', () => {
    const active = migrateGraphDocument(structuredClone(legacyDemo));
    const invalid = structuredClone(active) as GraphDocument;
    invalid.graph.nodes[1].id = invalid.graph.nodes[0].id;
    let current = active;

    expect(() => {
      const candidate = parseGraphDocumentText(JSON.stringify(invalid));
      current = candidate;
    }).toThrow('$.graph.nodes[1].id: duplicate node id netIncome');
    expect(current).toBe(active);
  });

  it.each([
    [
      'dangling endpoint',
      (document: GraphDocument) => {
        document.graph.edges[0].source = 'missing';
      },
      '$.graph.edges[0].source: unknown node missing',
    ],
    [
      'non-finite authored value',
      (document: GraphDocument) => {
        const income = document.graph.nodes.find((node) => node.kind === 'income');
        if (income?.kind === 'income') {
          income.baseValue = Number.POSITIVE_INFINITY;
        }
      },
      '$.graph.nodes[0].baseValue: must be a finite number',
    ],
    [
      'unsupported schema',
      (document: GraphDocument) => {
        (document as { schemaVersion: number }).schemaVersion = 2;
      },
      '$.schemaVersion: unsupported schema version 2',
    ],
  ])('rejects %s before replacement', (_name, mutate, message) => {
    const invalid = structuredClone(migrateGraphDocument(legacyDemo));
    mutate(invalid);
    expect(() => migrateGraphDocument(invalid)).toThrow(message);
  });
});

describe('autosave and recovery storage', () => {
  it('restores authored edits and falls back to the previous last-good revision', () => {
    const storage = new MemoryStorage();
    const repository = new GraphDocumentStorage(storage);
    const first = migrateGraphDocument(legacyDemo);
    repository.save(first);

    const editedGraph = graphDocumentToRuntimeGraph(first);
    const income = editedGraph.nodes.find((node) => node.id === 'netIncome');
    if (!income) {
      throw new Error('Expected income node');
    }
    income.baseValue = 4_500;
    const edited = createGraphDocument(editedGraph, first.settings.simulation);
    repository.save(edited);

    expect(repository.load(legacyDemo).document).toEqual(edited);

    storage.setItem(DOCUMENT_STORAGE_KEYS.current, '{interrupted');
    const recovered = repository.load(legacyDemo);
    expect(recovered.source).toBe('last-good');
    expect(recovered.recovered).toBe(true);
    expect(recovered.document).toEqual(first);
  });

  it('recovers a fully validated interrupted temporary write', () => {
    const storage = new MemoryStorage();
    const repository = new GraphDocumentStorage(storage);
    repository.save(migrateGraphDocument(legacyDemo));
    const validEnvelope = storage.getItem(DOCUMENT_STORAGE_KEYS.current);
    if (!validEnvelope) {
      throw new Error('Expected saved envelope');
    }
    storage.setItem(DOCUMENT_STORAGE_KEYS.temporary, validEnvelope);
    storage.setItem(DOCUMENT_STORAGE_KEYS.current, '{broken');

    const recovered = repository.load(legacyDemo);
    expect(recovered.source).toBe('temporary');
    expect(recovered.document).toEqual(migrateGraphDocument(legacyDemo));
  });
});
