import { computeGraph } from '../../src/engine/computeGraph';
import { graphDocumentToRuntimeGraph, migrateGraphDocument } from '../../src/document/graphDocument';
import type { EconEdgeData, EconNodeData, GraphComputeResult, GraphData } from '../../src/models/types';

export const graph = (nodes: EconNodeData[], edges: EconEdgeData[] = [], nodeScale?: number): GraphData => ({
  nodes,
  edges,
  ...(nodeScale === undefined ? {} : { nodeScale }),
});

export const flow = (
  id: string,
  source: string,
  target: string,
  ports: Pick<EconEdgeData, 'sourcePort' | 'targetPort'> = {},
): EconEdgeData => ({
  id,
  source,
  target,
  kind: 'flow',
  ...ports,
});

export const computeFixture = (fixture: GraphData): GraphComputeResult => {
  const isolated = structuredClone(fixture);
  return computeGraph(isolated.nodes, isolated.edges);
};

export const computeMigratedFixture = (fixture: GraphData): GraphComputeResult => {
  const document = migrateGraphDocument(structuredClone(fixture));
  const graphData = graphDocumentToRuntimeGraph(document);
  return computeGraph(graphData.nodes, graphData.edges, document.settings.simulation);
};

export const requireNode = (result: GraphComputeResult, id: string): EconNodeData => {
  const node = result.nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Expected computed node ${id}`);
  }
  return node;
};

export const jsonRoundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
