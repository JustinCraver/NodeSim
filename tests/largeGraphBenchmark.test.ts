import { expect, it } from 'vitest';
import { computeGraph } from '../src/engine/computeGraph';
import { createGraphDocument } from '../src/document/graphDocument';
import { GraphDocumentStore } from '../src/document/documentStore';
import type { EconNodeData, GraphData } from '../src/models/types';

const LARGE_GRAPH_NODE_COUNT = 4_000;
const INTERACTION_GRAPH_NODE_COUNT = 1_000;
const INTERACTION_ROUND_TRIPS = 25;
const COMPUTE_BUDGET_MS = 750;
const INTERACTION_BUDGET_MS = 3_000;

const values = (count: number): EconNodeData[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `value-${index}`,
    label: `Value ${index}`,
    kind: 'value',
    baseValue: index,
    position: { x: index % 100, y: Math.floor(index / 100) },
  }));

it(
  'keeps defined large-graph compute and command-history interactions within budget',
  () => {
    const computeNodes = values(LARGE_GRAPH_NODE_COUNT);
    const computeStart = performance.now();
    const result = computeGraph(computeNodes, []);
    const computeMs = performance.now() - computeStart;
    expect(result.errors).toEqual({});

    const interactionGraph: GraphData = { nodes: values(INTERACTION_GRAPH_NODE_COUNT), edges: [] };
    const store = new GraphDocumentStore(createGraphDocument(interactionGraph));
    const interactionStart = performance.now();
    for (let index = 0; index < INTERACTION_ROUND_TRIPS; index += 1) {
      const nodeId = `value-${index}`;
      store.execute({
        type: 'move-node',
        graphPath: Object.freeze([]),
        nodeId,
        position: { x: index * 2, y: index * 3 },
      });
      store.undo();
      store.redo();
    }
    const interactionMs = performance.now() - interactionStart;

    console.info(
      `large-graph benchmark nodes=${LARGE_GRAPH_NODE_COUNT} compute=${computeMs.toFixed(2)}ms ` +
        `interactionNodes=${INTERACTION_GRAPH_NODE_COUNT} ` +
        `moveUndoRedo=${INTERACTION_ROUND_TRIPS} interaction=${interactionMs.toFixed(2)}ms`,
    );
    expect(computeMs).toBeLessThan(COMPUTE_BUDGET_MS);
    expect(interactionMs).toBeLessThan(INTERACTION_BUDGET_MS);
  },
  10_000,
);
