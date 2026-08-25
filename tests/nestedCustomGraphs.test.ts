import { describe, expect, it } from 'vitest';
import nestedFixture from './fixtures/nested-two-level.v1.json';
import { DOCUMENT_STORAGE_KEYS, GraphDocumentStorage } from '../src/document/documentStorage';
import {
  createGraphDocument,
  graphDocumentToRuntimeGraph,
  migrateGraphDocument,
  parseGraphDocumentText,
  serializeGraphDocument,
} from '../src/document/graphDocument';
import { computeGraph } from '../src/engine/computeGraph';
import { diagnoseCustomBindings, repairCustomBindings } from '../src/graph/customBindings';
import {
  buildBreadcrumbs,
  buildViewStack,
  formatGraphPath,
  getGraphAtPath,
  leaveGraphView,
  replaceGraphAtPath,
  scopedNodeKey,
  type GraphPath,
} from '../src/graph/graphScope';
import type { EconNodeData, GraphData } from '../src/models/types';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const loadFixture = () => migrateGraphDocument(structuredClone(nestedFixture));

const computeDocument = (graph: GraphData) =>
  computeGraph(graph.nodes, graph.edges, loadFixture().settings.simulation);

const requireCustom = (graph: GraphData, nodeId: string) => {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node?.kind !== 'custom' || !node.custom) {
    throw new Error(`Expected custom node ${nodeId}`);
  }
  return node;
};

describe('scoped two-level custom graphs', () => {
  it('keeps repeated local IDs distinct and computes two nested custom levels', () => {
    const root = graphDocumentToRuntimeGraph(loadFixture());
    const result = computeDocument(root);

    expect(result.errors).toEqual({});
    expect(result.nodes.find((node) => node.id === 'result')?.computedValue).toBe(10);
    expect(scopedNodeKey({ graphPath: [], nodeId: 'shared' })).not.toBe(
      scopedNodeKey({ graphPath: ['nested'], nodeId: 'shared' }),
    );
    expect(scopedNodeKey({ graphPath: ['nested'], nodeId: 'shared' })).not.toBe(
      scopedNodeKey({ graphPath: ['nested', 'nested'], nodeId: 'shared' }),
    );
  });

  it('builds an immutable view stack with breadcrumbs and edits the exact deepest scope', () => {
    const root = graphDocumentToRuntimeGraph(loadFixture());
    const path: GraphPath = Object.freeze(['nested', 'nested']);
    const stack = buildViewStack(root, path);
    const deepest = structuredClone(getGraphAtPath(root, path));
    const calc = deepest.nodes.find((node) => node.id === 'calc');
    if (calc?.kind !== 'calc') {
      throw new Error('Expected deepest calc node');
    }
    calc.formula = 'shared * 3';
    const edited = replaceGraphAtPath(root, path, deepest);
    const firstBack = leaveGraphView(stack, deepest);
    const rootBack = leaveGraphView(firstBack.stack, firstBack.graph);

    expect(stack.map((frame) => formatGraphPath(frame.parentPath))).toEqual(['/root', '/root/nested']);
    expect(buildBreadcrumbs(stack).map((breadcrumb) => breadcrumb.label)).toEqual([
      'Main Graph',
      'Outer custom',
      'Inner custom',
    ]);
    expect(computeDocument(edited).nodes.find((node) => node.id === 'result')?.computedValue).toBe(15);
    expect(firstBack.selection).toEqual({ graphPath: ['nested'], nodeId: 'nested' });
    expect(rootBack.selection).toEqual({ graphPath: [], nodeId: 'nested' });
    expect(computeDocument(rootBack.graph).nodes.find((node) => node.id === 'result')?.computedValue).toBe(15);
    expect(getGraphAtPath(root, path).nodes.find((node) => node.id === 'calc')).toMatchObject({
      formula: 'shared * 2',
    });
  });

  it('retains nested edits through export, reimport, autosave, and last-good recovery', () => {
    const first = graphDocumentToRuntimeGraph(loadFixture());
    const path: GraphPath = ['nested', 'nested'];
    const deepest = structuredClone(getGraphAtPath(first, path));
    const calc = deepest.nodes.find((node) => node.id === 'calc');
    if (calc?.kind !== 'calc') {
      throw new Error('Expected deepest calc node');
    }
    calc.formula = 'shared * 4';
    const edited = replaceGraphAtPath(first, path, deepest);
    const exported = serializeGraphDocument(createGraphDocument(edited, loadFixture().settings.simulation));
    const reimported = parseGraphDocumentText(exported);

    expect(computeDocument(graphDocumentToRuntimeGraph(reimported)).nodes.find((node) => node.id === 'result')?.computedValue).toBe(20);

    const storage = new MemoryStorage();
    const repository = new GraphDocumentStorage(storage);
    repository.save(reimported);
    const nextGraph = graphDocumentToRuntimeGraph(reimported);
    nextGraph.nodes.find((node) => node.id === 'shared')!.baseValue = 6;
    repository.save(createGraphDocument(nextGraph, reimported.settings.simulation));
    storage.setItem(DOCUMENT_STORAGE_KEYS.current, '{interrupted');
    const recovered = repository.load(first);

    expect(recovered.source).toBe('last-good');
    expect(recovered.document).toEqual(reimported);
    expect(getGraphAtPath(graphDocumentToRuntimeGraph(recovered.document), path).nodes).toEqual(deepest.nodes);
  });

  it('leaves malformed bindings unchanged until explicit repair and filters by compatible type', () => {
    const root = graphDocumentToRuntimeGraph(loadFixture());
    const outer = requireCustom(root, 'nested');
    const malformed = structuredClone(outer.custom!);
    malformed.inputBindings.in = 'missing-local-id';
    const before = structuredClone(malformed);

    const diagnostics = diagnoseCustomBindings(malformed, '/root', 'nested');
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'invalid_port',
      graphPath: '/root',
      nodeId: 'nested',
      portId: 'in',
      cause: 'Unknown internal node missing-local-id',
    }));
    expect(malformed).toEqual(before);

    const repaired = repairCustomBindings(malformed, '/root', 'nested');
    expect(repaired.repairedPortIds).toEqual(['in']);
    expect(repaired.unresolvedDiagnostics).toEqual([]);
    expect(repaired.custom.inputBindings.in).not.toBe('missing-local-id');
    expect(repaired.custom.internalGraph.nodes.find(
      (node: EconNodeData) => node.id === repaired.custom.inputBindings.in,
    )).toMatchObject({ kind: 'value', baseValue: 0 });
    expect(malformed).toEqual(before);
  });

  it('reports the exact nested graph path, node, edge, port, and cause', () => {
    const root = graphDocumentToRuntimeGraph(loadFixture());
    const outer = requireCustom(root, 'nested');
    const inner = requireCustom(outer.custom!.internalGraph, 'nested');
    inner.custom!.internalGraph.edges[0].sourcePort = 'invalid-port';
    const result = computeDocument(root);
    const diagnostic = result.diagnostics.find((candidate) => candidate.graphPath === '/root/nested/nested');

    expect(diagnostic).toMatchObject({
      code: 'invalid_port',
      graphPath: '/root/nested/nested',
      nodeId: 'calc',
      edgeId: 'shared-calc',
      portId: 'invalid-port',
      message: 'value has no named source ports',
      cause: 'Port invalid-port is not declared by shared',
    });
  });
});
