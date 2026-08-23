import { describe, expect, it } from 'vitest';
import type { EconEdgeData, EconNodeData, NodeKind, TimeUnit } from '../src/models/types';
import { computeFixture, flow, graph, requireNode } from './harness/graphHarness';

const CHARACTERIZED_NODE_KINDS = {
  income: 'monthly-flow normalization',
  expense: 'monthly-flow normalization',
  value: 'scalar nodes',
  add: 'binary nodes',
  subtract: 'binary nodes',
  multiply: 'binary nodes',
  divide: 'binary nodes',
  calc: 'formula nodes',
  asset: 'asset simulation',
  output: 'target-month output',
  custom: 'custom ports and bindings',
  text: 'presentation-only nodes',
} satisfies Record<NodeKind, string>;

describe('node-kind coverage manifest', () => {
  it('stays exhaustive when the NodeKind union changes', () => {
    expect(Object.keys(CHARACTERIZED_NODE_KINDS)).toHaveLength(12);
  });
});

describe('monthly-flow normalization', () => {
  it.each([
    ['per_day', 360],
    ['per_week', 52],
    ['per_month', 12],
    ['per_year', 1],
  ] satisfies [TimeUnit, number][])('normalizes %s income and expense values', (timeUnit, expected) => {
    const result = computeFixture(
      graph([
        { id: 'income', label: 'Income', kind: 'income', baseValue: 12, timeUnit },
        { id: 'expense', label: 'Expense', kind: 'expense', baseValue: 12, timeUnit },
      ]),
    );

    expect(result.errors).toEqual({});
    expect(requireNode(result, 'income').computedValue).toBeCloseTo(expected, 10);
    expect(requireNode(result, 'expense').computedValue).toBeCloseTo(expected, 10);
  });

  it('defaults a missing base value to zero and a missing unit to monthly', () => {
    const result = computeFixture(
      graph([
        { id: 'missing', label: 'Missing', kind: 'income' },
        { id: 'monthly', label: 'Monthly', kind: 'expense', baseValue: 25 },
      ]),
    );

    expect(requireNode(result, 'missing').computedValue).toBe(0);
    expect(requireNode(result, 'monthly').computedValue).toBe(25);
  });
});

describe('scalar and binary nodes', () => {
  it('uses a value node base value when disconnected and sums all incoming values when connected', () => {
    const result = computeFixture(
      graph(
        [
          { id: 'two', label: 'Two', kind: 'value', baseValue: 2 },
          { id: 'three', label: 'Three', kind: 'value', baseValue: 3 },
          { id: 'base', label: 'Base', kind: 'value', baseValue: 7 },
          { id: 'sum', label: 'Sum', kind: 'value', baseValue: 99 },
        ],
        [flow('two-sum', 'two', 'sum'), flow('three-sum', 'three', 'sum')],
      ),
    );

    expect(requireNode(result, 'base').computedValue).toBe(7);
    expect(requireNode(result, 'sum').computedValue).toBe(5);
  });

  it.each([
    ['add', 8, 2, 10],
    ['subtract', 8, 2, 6],
    ['multiply', 8, 2, 16],
    ['divide', 8, 2, 4],
  ] satisfies [Extract<NodeKind, 'add' | 'subtract' | 'multiply' | 'divide'>, number, number, number][])(
    '%s uses its disconnected left/right authored values',
    (kind, leftValue, rightValue, expected) => {
      const result = computeFixture(graph([{ id: kind, label: kind, kind, leftValue, rightValue }]));
      const node = requireNode(result, kind);

      expect(result.errors).toEqual({});
      expect(node.computedValue).toBe(expected);
      expect(node.input1Connected).toBe(false);
      expect(node.input2Connected).toBe(false);
    },
  );

  it.each([
    ['add', 10],
    ['subtract', 6],
    ['multiply', 16],
    ['divide', 4],
  ] satisfies [Extract<NodeKind, 'add' | 'subtract' | 'multiply' | 'divide'>, number][])(
    '%s routes connected values through explicit binary ports',
    (kind, expected) => {
      const nodes: EconNodeData[] = [
        { id: 'left', label: 'Left', kind: 'value', baseValue: 8 },
        { id: 'right', label: 'Right', kind: 'value', baseValue: 2 },
        { id: 'operator', label: 'Operator', kind },
      ];
      const edges: EconEdgeData[] = [
        flow('left-operator', 'left', 'operator', { targetPort: '1' }),
        flow('right-operator', 'right', 'operator', { targetPort: '2' }),
      ];
      const result = computeFixture(graph(nodes, edges));
      const node = requireNode(result, 'operator');

      expect(node.computedValue).toBe(expected);
      expect(node.input1Value).toBe(8);
      expect(node.input2Value).toBe(2);
      expect(node.input1Connected).toBe(true);
      expect(node.input2Connected).toBe(true);
    },
  );

  it('aggregates repeated binary-port inputs before applying the operator', () => {
    const result = computeFixture(
      graph(
        [
          { id: 'a', label: 'A', kind: 'value', baseValue: 2 },
          { id: 'b', label: 'B', kind: 'value', baseValue: 3 },
          { id: 'c', label: 'C', kind: 'value', baseValue: 4 },
          { id: 'add', label: 'Add', kind: 'add' },
        ],
        [
          flow('a-add', 'a', 'add', { targetPort: 'left' }),
          flow('b-add', 'b', 'add', { targetPort: '1' }),
          flow('c-add', 'c', 'add', { targetPort: 'right' }),
        ],
      ),
    );

    expect(requireNode(result, 'add').computedValue).toBe(9);
  });
});

describe('formula nodes', () => {
  it.each([
    ['a + b * 2', 8],
    ['(a + b) * 2', 10],
    ['-a + b', 1],
    ['sum(a, b)', 5],
    ['min(a, b)', 2],
    ['max(a, b)', 3],
  ])('evaluates the currently supported expression %s', (formula, expected) => {
    const result = computeFixture(
      graph(
        [
          { id: 'a', label: 'A', kind: 'value', baseValue: 2 },
          { id: 'b', label: 'B', kind: 'value', baseValue: 3 },
          { id: 'calc', label: 'Calc', kind: 'calc', formula },
        ],
        [flow('a-calc', 'a', 'calc'), flow('b-calc', 'b', 'calc')],
      ),
    );

    expect(result.errors).toEqual({});
    expect(requireNode(result, 'calc').computedValue).toBe(expected);
  });
});

describe('asset, output, and text nodes', () => {
  it('models 120 end-of-month contributions using nominal annual rate divided by twelve', () => {
    const result = computeFixture(
      graph(
        [
          { id: 'contribution', label: 'Contribution', kind: 'income', baseValue: 100, timeUnit: 'per_month' },
          { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0.12 },
        ],
        [flow('contribution-asset', 'contribution', 'asset')],
      ),
    );
    const asset = requireNode(result, 'asset');
    const expectedEndingBalance = (100 * (Math.pow(1.01, 120) - 1)) / 0.01;

    expect(asset.timeseries).toHaveLength(120);
    expect(asset.timeseries?.[0]).toBe(100);
    expect(asset.timeseries?.[1]).toBeCloseTo(201, 10);
    expect(asset.computedValue).toBeCloseTo(expectedEndingBalance, 6);
  });

  it('returns a one-based target month and a tagged unreachable state', () => {
    const result = computeFixture(
      graph(
        [
          { id: 'contribution', label: 'Contribution', kind: 'income', baseValue: 100, timeUnit: 'per_month' },
          { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
          { id: 'reached', label: 'Reached', kind: 'output', targetAmount: 250 },
          { id: 'unreachable', label: 'Unreachable', kind: 'output', targetAmount: 20_000 },
        ],
        [
          flow('contribution-asset', 'contribution', 'asset'),
          flow('asset-reached', 'asset', 'reached', { sourcePort: 'balance' }),
          flow('asset-unreachable', 'asset', 'unreachable', { sourcePort: 'balance' }),
        ],
      ),
    );

    expect(requireNode(result, 'reached').computedValue).toBe(3);
    expect(requireNode(result, 'unreachable').computedValue).toBeUndefined();
    expect(requireNode(result, 'unreachable').outputState).toEqual({ kind: 'unreachable' });
  });

  it('keeps text nodes outside computation', () => {
    const result = computeFixture(graph([{ id: 'note', label: 'A note', kind: 'text' }]));

    expect(result.errors).toEqual({});
    expect(requireNode(result, 'note').computedValue).toBeUndefined();
  });
});

describe('current computation errors', () => {
  it.each([
    [
      [{ id: 'divide', label: 'Divide', kind: 'divide', leftValue: 10, rightValue: 0 }],
      [],
      'divide',
      'Division by zero',
    ],
    [[{ id: 'calc', label: 'Calc', kind: 'calc', formula: '' }], [], 'calc', 'Missing formula'],
    [[{ id: 'calc', label: 'Calc', kind: 'calc', formula: 'missing + 1' }], [], 'calc', 'Unknown variable: missing'],
    [[{ id: 'calc', label: 'Calc', kind: 'calc', formula: '(1 + 2' }], [], 'calc', 'Mismatched parentheses'],
    [[{ id: 'output', label: 'Output', kind: 'output' }], [], 'output', 'Missing target amount'],
    [
      [{ id: 'output', label: 'Output', kind: 'output', targetAmount: 100 }],
      [],
      'output',
      'Missing asset timeseries',
    ],
    [[{ id: 'custom', label: 'Custom', kind: 'custom' }], [], 'custom', 'Missing custom config'],
  ] satisfies [EconNodeData[], EconEdgeData[], string, string][])(
    'reports %s',
    (nodes, edges, nodeId, message) => {
      const result = computeFixture(graph(nodes, edges));

      expect(result.errors[nodeId]).toBe(message);
      expect(requireNode(result, nodeId).computedValue).toBeUndefined();
    },
  );
});
