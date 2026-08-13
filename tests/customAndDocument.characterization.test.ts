import { describe, expect, it } from 'vitest';
import type { EconNodeData, GraphData } from '../src/models/types';
import { computeFixture, flow, graph, jsonRoundTrip, requireNode } from './harness/graphHarness';

const makeMultiPortFixture = (): GraphData =>
  graph(
    [
      { id: 'outerGross', label: 'Gross', kind: 'value', baseValue: 10 },
      { id: 'outerFee', label: 'Fee', kind: 'value', baseValue: 3 },
      {
        id: 'adjuster',
        label: 'Adjuster',
        kind: 'custom',
        custom: {
          inputs: [
            { id: 'inGross', label: 'Gross' },
            { id: 'inFee', label: 'Fee' },
          ],
          outputs: [
            { id: 'outNet', label: 'Net' },
            { id: 'outTotal', label: 'Total' },
          ],
          internalGraph: graph(
            [
              { id: 'gross', label: 'Gross', kind: 'value', baseValue: 0 },
              { id: 'fee', label: 'Fee', kind: 'income', baseValue: 0, timeUnit: 'per_year' },
              { id: 'net', label: 'Net', kind: 'calc', formula: 'gross - fee' },
              { id: 'total', label: 'Total', kind: 'calc', formula: 'gross + fee' },
            ],
            [
              flow('gross-net', 'gross', 'net'),
              flow('fee-net', 'fee', 'net'),
              flow('gross-total', 'gross', 'total'),
              flow('fee-total', 'fee', 'total'),
            ],
          ),
          inputBindings: {
            inGross: 'gross',
            inFee: 'fee',
          },
          outputBindings: {
            outNet: 'net',
            outTotal: 'total',
          },
        },
      },
      { id: 'netSink', label: 'Net sink', kind: 'value', baseValue: 0 },
      { id: 'totalSink', label: 'Total sink', kind: 'value', baseValue: 0 },
    ],
    [
      flow('gross-adjuster', 'outerGross', 'adjuster', { targetPort: 'inGross' }),
      flow('fee-adjuster', 'outerFee', 'adjuster', { targetPort: 'inFee' }),
      flow('adjuster-net', 'adjuster', 'netSink', { sourcePort: 'outNet' }),
      flow('adjuster-total', 'adjuster', 'totalSink', { sourcePort: 'outTotal' }),
    ],
  );

describe('custom node ports and bindings', () => {
  it('binds distinct inputs, publishes distinct outputs, and sums outputs for the custom scalar', () => {
    const result = computeFixture(makeMultiPortFixture());

    expect(result.errors).toEqual({});
    expect(result.customOutputs?.get('adjuster')?.get('outNet')).toBe(7);
    expect(result.customOutputs?.get('adjuster')?.get('outTotal')).toBe(13);
    expect(requireNode(result, 'adjuster').computedValue).toBe(20);
    expect(requireNode(result, 'netSink').computedValue).toBe(7);
    expect(requireNode(result, 'totalSink').computedValue).toBe(13);
  });

  it('uses the first declared input and output when edge ports are omitted', () => {
    const fixture = makeMultiPortFixture();
    fixture.edges = [
      flow('gross-adjuster', 'outerGross', 'adjuster'),
      flow('adjuster-sink', 'adjuster', 'netSink'),
    ];
    const result = computeFixture(fixture);

    expect(result.errors).toEqual({});
    expect(result.customOutputs?.get('adjuster')?.get('outNet')).toBe(10);
    expect(result.customOutputs?.get('adjuster')?.get('outTotal')).toBe(10);
    expect(requireNode(result, 'netSink').computedValue).toBe(10);
  });

  it('reports unknown ports and missing bindings without throwing', () => {
    const custom: EconNodeData = {
      id: 'custom',
      label: 'Custom',
      kind: 'custom',
      custom: {
        inputs: [{ id: 'in', label: 'In' }],
        outputs: [{ id: 'out', label: 'Out' }],
        internalGraph: graph([{ id: 'internal', label: 'Internal', kind: 'value', baseValue: 5 }]),
        inputBindings: {},
        outputBindings: {},
      },
    };
    const result = computeFixture(
      graph(
        [
          { id: 'source', label: 'Source', kind: 'value', baseValue: 2 },
          custom,
        ],
        [flow('source-custom', 'source', 'custom', { targetPort: 'unknown' })],
      ),
    );

    expect(result.errors.custom).toContain('Unknown input port unknown');
    expect(result.errors.custom).toContain('Missing input binding for in');
    expect(result.errors.custom).toContain('Missing output binding for out');
    expect(result.customOutputs?.get('custom')?.get('out')).toBe(0);
  });
});

describe('current unversioned JSON document format', () => {
  it('round-trips nested custom graphs, stable ports, layout, edge metadata, and derived fields', () => {
    const fixture = makeMultiPortFixture();
    fixture.nodeScale = 1.25;
    fixture.nodes[0] = {
      ...fixture.nodes[0],
      position: { x: 10, y: 20 },
      computedValue: 10,
      timeseries: [10, 20],
    };
    fixture.edges[0] = {
      ...fixture.edges[0],
      weight: 0.5,
      lagMonths: 2,
    };

    const roundTripped = jsonRoundTrip(fixture);

    expect(roundTripped).toEqual(fixture);
    expect('version' in roundTripped).toBe(false);
    expect(roundTripped.nodes.find((node) => node.id === 'adjuster')?.custom?.outputs).toEqual([
      { id: 'outNet', label: 'Net' },
      { id: 'outTotal', label: 'Total' },
    ]);
  });

  it('retains custom computation after a JSON export/import round trip', () => {
    const before = computeFixture(makeMultiPortFixture());
    const after = computeFixture(jsonRoundTrip(makeMultiPortFixture()));

    expect(after.errors).toEqual(before.errors);
    expect(requireNode(after, 'netSink').computedValue).toBe(requireNode(before, 'netSink').computedValue);
    expect(requireNode(after, 'totalSink').computedValue).toBe(requireNode(before, 'totalSink').computedValue);
  });
});
