import { describe, expect, it } from 'vitest';
import { GraphDocumentStore, type DocumentSelection } from '../src/document/documentStore';
import { createGraphDocument, graphDocumentToRuntimeGraph, parseGraphDocumentText, serializeGraphDocument } from '../src/document/graphDocument';
import { getCompatibleOutputBindingNodes, repairCustomBindings } from '../src/graph/customBindings';
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

  it('commits input type and binding together and removes only newly incompatible connections', () => {
    const graph = baseGraph();
    graph.nodes[1].custom!.internalGraph.nodes.push({ id: 'flow', label: 'Flow', kind: 'income', baseValue: 3, timeUnit: 'per_month' });
    graph.nodes.push({ id: 'spare', label: 'Spare', kind: 'value', baseValue: 2 });
    graph.edges.push({ id: 'unrelated', source: 'source', target: 'spare', kind: 'flow' });
    const initial = createGraphDocument(graph);
    const store = new GraphDocumentStore(initial);
    const custom = graphDocumentToRuntimeGraph(initial).nodes[1].custom!;
    store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: {
      ...custom, inputs: [{ ...custom.inputs[0], valueType: 'monthly-flow' }], inputBindings: { input: 'flow' },
    } });
    const updated = store.getSnapshot().document;
    expect(updated.graph.edges.map((edge) => edge.id)).toEqual(['unrelated']);
    expect(parseGraphDocumentText(serializeGraphDocument(updated))).toEqual(updated);
    expect(store.getSnapshot()).toMatchObject({ revision: 2, lastCommand: 'update-custom-ports' });
    store.undo();
    expect(store.getSnapshot().document).toEqual(initial);
    store.redo();
    expect(store.getSnapshot().document).toEqual(updated);
  });

  it('removes newly incompatible output connections while retaining compatible ones', () => {
    const graph = baseGraph();
    graph.nodes[1].custom!.internalGraph.nodes.push({ id: 'flow', label: 'Flow', kind: 'income', baseValue: 3, timeUnit: 'per_month' });
    graph.nodes.push({ id: 'sink', label: 'Sink', kind: 'value', baseValue: 0 }, { id: 'formula', label: 'Formula', kind: 'calc', formula: 'custom', outputType: 'scalar' });
    graph.edges.push({ id: 'to-value', source: 'custom', sourcePort: 'output', target: 'sink', kind: 'flow' }, { id: 'to-formula', source: 'custom', sourcePort: 'output', target: 'formula', kind: 'flow' });
    const initial = createGraphDocument(graph);
    const store = new GraphDocumentStore(initial);
    const custom = graphDocumentToRuntimeGraph(initial).nodes[1].custom!;
    store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: {
      ...custom, outputs: [{ ...custom.outputs[0], valueType: 'monthly-flow' }], outputBindings: { output: 'flow' },
    } });
    expect(store.getSnapshot().document.graph.edges.map((edge) => edge.id)).toEqual(['source-custom', 'to-formula']);
    store.undo();
    expect(store.getSnapshot().document).toEqual(initial);
  });

  it('offers bindings using authored arithmetic types rather than absent runtime caches', () => {
    const graph: GraphData = {
      nodes: [{ id: 'flow', label: 'Flow', kind: 'income', baseValue: 1, timeUnit: 'per_month' }, { id: 'sum', label: 'Sum', kind: 'add', leftValue: 0, rightValue: 0 }],
      edges: [{ id: 'flow-sum', source: 'flow', target: 'sum', targetPort: '1', kind: 'flow' }],
    };
    expect(getCompatibleOutputBindingNodes(graph, 'monthly-flow').map((node) => node.id)).toEqual(['flow', 'sum']);
    expect(getCompatibleOutputBindingNodes(graph, 'scalar')).toEqual([]);
  });

  it('adds complete ports, preserves existing IDs/edges, and round-trips the root from a nested scope', () => {
    const initial = createGraphDocument(baseGraph());
    const store = new GraphDocumentStore(initial);
    const custom = graphDocumentToRuntimeGraph(initial).nodes[1].custom!;
    store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: {
      ...custom,
      inputs: [...custom.inputs, { id: 'new-input', label: 'New input', valueType: 'scalar' }],
      outputs: [...custom.outputs, { id: 'new-output', label: 'New output', valueType: 'scalar', formulaId: 'extra' }],
      inputBindings: { ...custom.inputBindings, 'new-input': 'inner' },
      outputBindings: { ...custom.outputBindings, 'new-output': 'inner' },
      // This command cannot replace the internal graph, even if its caller supplies different data.
      internalGraph: { nodes: [], edges: [] },
    } });
    const added = store.getSnapshot().document;
    expect(added.graph.edges).toEqual(initial.graph.edges);
    const wrapper = createGraphDocument({ nodes: [{ id: 'outer', label: 'Outer', kind: 'custom', custom: {
      inputs: [], outputs: [], inputBindings: {}, outputBindings: {}, internalGraph: graphDocumentToRuntimeGraph(added),
    } }], edges: [] });
    const nestedStore = new GraphDocumentStore(wrapper);
    const nestedCustom = graphDocumentToRuntimeGraph(added).nodes[1].custom!;
    nestedStore.execute({ type: 'update-custom-ports', graphPath: ['outer'], nodeId: 'custom', custom: {
      ...nestedCustom, outputs: nestedCustom.outputs.filter((port) => port.id !== 'new-output'), outputBindings: { output: 'inner' },
    } });
    expect(parseGraphDocumentText(serializeGraphDocument(nestedStore.getSnapshot().document))).toEqual(nestedStore.getSnapshot().document);
    nestedStore.undo();
    expect(nestedStore.getSnapshot().document).toEqual(wrapper);
    store.undo();
    expect(store.getSnapshot().document).toEqual(initial);
    store.redo();
    expect(store.getSnapshot().document).toEqual(added);
  });

  it('rejects incomplete/incompatible bindings and duplicate formula identities without changing history', () => {
    const store = new GraphDocumentStore(createGraphDocument(baseGraph()));
    const before = store.getSnapshot();
    const custom = graphDocumentToRuntimeGraph(before.document).nodes[1].custom!;
    const invalid = [
      { ...custom, inputBindings: { input: '' } },
      { ...custom, inputs: [{ ...custom.inputs[0], valueType: 'monthly-flow' as const }] },
      { ...custom, outputs: [...custom.outputs, { id: 'another', label: 'Another', valueType: 'scalar' as const, formulaId: 'result' }], outputBindings: { output: 'inner', another: 'inner' } },
    ];
    for (const candidate of invalid) {
      expect(() => store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: candidate })).toThrow();
      expect(store.getSnapshot()).toEqual(before);
    }
    store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: { ...custom, inputs: [{ ...custom.inputs[0], label: 'Renamed' }] } });
    expect(store.getSnapshot().document.graph.edges).toEqual(before.document.graph.edges);
    store.undo();
    expect(store.getSnapshot().document).toEqual(before.document);
  });

  it('applies deliberate graph/binding repair atomically, preserving external edges and undoing placeholders', () => {
    const initial = createGraphDocument(baseGraph());
    const store = new GraphDocumentStore(initial);
    const custom = graphDocumentToRuntimeGraph(initial).nodes[1].custom!;
    const draft = { ...custom, internalGraph: { nodes: [], edges: [] } };
    expect(() => store.execute({ type: 'replace-nested-graph', graphPath: ['custom'], graph: draft.internalGraph })).toThrow(/unknown internal node/);
    expect(store.getSnapshot()).toMatchObject({ document: initial, revision: 1, canUndo: false });
    const repaired = repairCustomBindings(draft, '/root', 'custom');
    expect(repaired.unresolvedDiagnostics).toEqual([]);
    store.execute({ type: 'repair-custom-bindings', graphPath: ROOT, nodeId: 'custom', custom: repaired.custom });
    const result = store.getSnapshot().document;
    expect(result.graph.edges).toEqual(initial.graph.edges);
    expect(result.graph.nodes[1].kind === 'custom' && result.graph.nodes[1].custom.internalGraph.nodes.map((node) => node.id)).toEqual(['repair-input-input', 'repair-output-output']);
    expect(parseGraphDocumentText(serializeGraphDocument(result))).toEqual(result);
    store.undo();
    expect(store.getSnapshot().document).toEqual(initial);
    store.redo();
    expect(store.getSnapshot().document).toEqual(result);
    const before = store.getSnapshot();
    expect(() => store.execute({ type: 'repair-custom-bindings', graphPath: ROOT, nodeId: 'custom', custom: { ...repaired.custom, inputs: [] } })).toThrow(/cannot change port definitions/);
    expect(store.getSnapshot()).toEqual(before);
  });

  it('removes scalar-incompatible lag after an output type change but preserves unaffected ports', () => {
    const graph = baseGraph();
    const custom = graph.nodes[1].custom!;
    custom.internalGraph.nodes.push({ id: 'flow', label: 'Flow', kind: 'income', baseValue: 1, timeUnit: 'per_month' });
    custom.outputs.push({ id: 'flow-output', label: 'Flow output', valueType: 'monthly-flow', formulaId: 'flow' });
    custom.outputBindings['flow-output'] = 'flow';
    graph.nodes.push({ id: 'formula', label: 'Formula', kind: 'calc', formula: '1', outputType: 'scalar' });
    graph.edges.push({ id: 'lagged', source: 'custom', sourcePort: 'flow-output', target: 'formula', kind: 'flow', lagMonths: 1 });
    const store = new GraphDocumentStore(createGraphDocument(graph));
    const initial = store.getSnapshot().document;
    store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: {
      ...custom, outputs: custom.outputs.map((port) => port.id === 'flow-output' ? { ...port, valueType: 'scalar' } : port), outputBindings: { ...custom.outputBindings, 'flow-output': 'inner' },
    } });
    expect(store.getSnapshot().document.graph.edges.map((edge) => edge.id)).toEqual(['source-custom']);
    store.undo();
    expect(store.getSnapshot().document).toEqual(initial);
  });

  it('preserves explicit asset-series output types through port and subsequent document commands', () => {
    const graph = baseGraph();
    graph.nodes[1].custom!.internalGraph.nodes.push({ id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 });
    graph.nodes.push({ id: 'goal', label: 'Goal', kind: 'output', targetAmount: 1 });
    const store = new GraphDocumentStore(createGraphDocument(graph));
    const custom = graphDocumentToRuntimeGraph(store.getSnapshot().document).nodes[1].custom!;
    store.execute({ type: 'update-custom-ports', graphPath: ROOT, nodeId: 'custom', custom: {
      ...custom, outputs: [...custom.outputs, { id: 'series', label: 'Balance', valueType: 'timeseries', formulaId: 'balance' }], outputBindings: { ...custom.outputBindings, series: 'asset' },
    } });
    store.execute({ type: 'add-edge', graphPath: ROOT, edge: { id: 'series-goal', source: 'custom', sourcePort: 'series', target: 'goal', kind: 'flow', weight: 1, lagMonths: 0 } });
    store.execute({ type: 'update-node', graphPath: ROOT, nodeId: 'source', changes: { baseValue: 20 } });
    const result = store.getSnapshot().document;
    const node = result.graph.nodes[1];
    expect(node.kind === 'custom' && node.custom.outputs.find((port) => port.id === 'series')?.valueType).toBe('timeseries');
    expect(parseGraphDocumentText(serializeGraphDocument(result))).toEqual(result);
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
