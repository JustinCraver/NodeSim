import { describe, expect, it } from 'vitest';
import multiOutputFixture from './fixtures/multi-output.v1.json';
import weightedLagFixture from './fixtures/weighted-lag.v1.json';
import { computeGraph } from '../src/engine/computeGraph';
import { graphDocumentToRuntimeGraph, migrateGraphDocument } from '../src/document/graphDocument';

const computeFixture = (fixture: unknown) => {
  const document = migrateGraphDocument(fixture);
  const graph = graphDocumentToRuntimeGraph(document);
  return computeGraph(graph.nodes, graph.edges, document.settings.simulation);
};

describe('checked-in semantic fixtures', () => {
  it('keeps weight-before-lag and the configured horizon deterministic', () => {
    const result = computeFixture(weightedLagFixture);
    const asset = result.nodes.find((node) => node.id === 'asset');
    const target = result.nodes.find((node) => node.id === 'target');

    expect(result.errors).toEqual({});
    expect(asset?.timeseries).toEqual([0, 0, 50, 100]);
    expect(target?.outputState).toEqual({ kind: 'month', month: 4 });
  });

  it('keeps custom formula identities independent after a versioned round trip', () => {
    const result = computeFixture(multiOutputFixture);

    expect(result.errors).toEqual({});
    expect(result.nodes.find((node) => node.id === 'formula')?.computedValue).toBe(10);
    expect(result.customOutputs.get('box')?.get('net-port')).toEqual({ type: 'scalar', value: 7 });
    expect(result.customOutputs.get('box')?.get('gross-port')).toEqual({ type: 'scalar', value: 3 });
  });
});
