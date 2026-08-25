import { describe, expect, it } from 'vitest';
import { GraphDocumentStore, type DocumentSelection } from '../src/document/documentStore';
import { createGraphDocument, graphDocumentToRuntimeGraph } from '../src/document/graphDocument';
import type { GraphData } from '../src/models/types';

const ROOT = Object.freeze([]);

const baseGraph = (): GraphData => ({
  nodes: [
    { id: 'source', label: 'Source', kind: 'value', baseValue: 10, position: { x: 0, y: 0 } },
    {
      id: 'custom',
      label: 'Custom',
      kind: 'custom',
      position: { x: 200, y: 0 },
      custom: {
        inputs: [{ id: 'input', label: 'Input', valueType: 'scalar' }],
        outputs: [{ id: 'output', label: 'Output', valueType: 'scalar', formulaId: 'result' }],
        internalGraph: {
          nodes: [{ id: 'inner', label: 'Inner', kind: 'value', baseValue: 1 }],
          edges: [],
        },
        inputBindings: { input: 'inner' },
        outputBindings: { output: 'inner' },
      },
    },
  ],
  edges: [
    {
      id: 'source-custom',
      source: 'source',
      target: 'custom',
      targetPort: 'input',
      kind: 'flow',
      weight: 1,
      lagMonths: 0,
    },
  ],
  nodeScale: 2,
});

const selectedSource: DocumentSelection = {
  graphPath: ROOT,
  kind: 'node',
  id: 'source',
  focus: true,
};

describe('GraphDocumentStore command history', () => {
  it('undoes and redoes destructive commands with selection and focus restoration', () => {
    const store = new GraphDocumentStore(createGraphDocument(baseGraph()));
    store.setSelection(selectedSource);

    store.execute({ type: 'delete-node', graphPath: ROOT, nodeId: 'source' }, undefined);
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.map((node) => node.id)).toEqual([
      'custom',
    ]);
    expect(store.getSnapshot().selection).toBeUndefined();

    expect(store.undo()).toBe(true);
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.map((node) => node.id)).toContain('source');
    expect(store.getSnapshot().selection).toEqual(selectedSource);

    expect(store.redo()).toBe(true);
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.map((node) => node.id)).not.toContain(
      'source',
    );
    expect(store.getSnapshot().selection).toBeUndefined();
  });

  it('treats port edits and their invalidated edges as one undoable command', () => {
    const store = new GraphDocumentStore(createGraphDocument(baseGraph()));
    const custom = graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.find(
      (node) => node.id === 'custom',
    )!.custom!;

    store.execute({
      type: 'update-custom-ports',
      graphPath: ROOT,
      nodeId: 'custom',
      custom: {
        ...custom,
        inputs: [],
        inputBindings: {},
      },
    });
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).edges).toHaveLength(0);

    store.undo();
    const restored = graphDocumentToRuntimeGraph(store.getSnapshot().document);
    expect(restored.edges.map((edge) => edge.id)).toEqual(['source-custom']);
    expect(restored.nodes.find((node) => node.id === 'custom')?.custom?.inputs).toHaveLength(1);
  });

  it('undoes nested graph, type, and layout commands independently', () => {
    const store = new GraphDocumentStore(createGraphDocument(baseGraph()));
    store.execute({
      type: 'replace-nested-graph',
      graphPath: Object.freeze(['custom']),
      graph: { nodes: [{ id: 'inner', label: 'Replacement', kind: 'value', baseValue: 5 }], edges: [] },
    });
    store.execute({
      type: 'change-node-type',
      graphPath: ROOT,
      nodeId: 'source',
      changes: { kind: 'calc', formula: '2 + 3', outputType: 'scalar', baseValue: undefined },
    });
    store.execute({
      type: 'move-node',
      graphPath: Object.freeze(['custom']),
      nodeId: 'inner',
      position: { x: 42, y: 84 },
    });

    let nested = graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.find(
      (node) => node.id === 'custom',
    )!.custom!.internalGraph;
    expect(nested.nodes[0]).toMatchObject({ kind: 'value', position: { x: 42, y: 84 } });
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes[0].kind).toBe('calc');

    store.undo();
    store.undo();
    nested = graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.find(
      (node) => node.id === 'custom',
    )!.custom!.internalGraph;
    expect(nested.nodes[0]).toMatchObject({ kind: 'value', baseValue: 5 });
    expect(nested.nodes[0].position).toBeUndefined();
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes[0].kind).toBe('value');

    store.undo();
    nested = graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes.find(
      (node) => node.id === 'custom',
    )!.custom!.internalGraph;
    expect(nested.nodes[0].id).toBe('inner');
  });

  it('makes atomic imports part of general undo and redo history', () => {
    const store = new GraphDocumentStore(createGraphDocument(baseGraph()));
    store.setSelection(selectedSource);
    const imported = createGraphDocument({
      nodes: [{ id: 'imported', label: 'Imported', kind: 'value', baseValue: 99 }],
      edges: [],
    });

    store.execute({ type: 'replace-document', document: imported }, undefined);
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes[0].id).toBe('imported');
    store.undo();
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes[0].id).toBe('source');
    expect(store.getSnapshot().selection).toEqual(selectedSource);
    store.redo();
    expect(graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes[0].id).toBe('imported');
  });
});
