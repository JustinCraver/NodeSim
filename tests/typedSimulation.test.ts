import { describe, expect, it } from 'vitest';
import { validateConnection } from '../src/engine/connectionValidation';
import { computeGraph } from '../src/engine/computeGraph';
import type { EconEdgeData, EconNodeData, SimulationSettingsV1 } from '../src/models/types';
import { flow, graph, requireNode } from './harness/graphHarness';

const settings = (horizonMonths: number): SimulationSettingsV1 => ({
  version: 1,
  horizonMonths,
  contributionTiming: 'end-of-month',
  annualRateConvention: 'nominal-divided-by-12',
  monthZero: 'initial-balance',
});

const compute = (nodes: EconNodeData[], edges: EconEdgeData[], horizonMonths: number) =>
  computeGraph(nodes, edges, settings(horizonMonths));

describe('typed values and connection compatibility', () => {
  it('publishes explicit scalar, monthly-flow, timeseries, and none output types', () => {
    const result = compute(
      [
        { id: 'income', label: 'Income', kind: 'income', baseValue: 10, timeUnit: 'per_month' },
        { id: 'scalar', label: 'Scalar', kind: 'value', baseValue: 2 },
        { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
        { id: 'note', label: 'Note', kind: 'text' },
      ],
      [flow('income-asset', 'income', 'asset')],
      2,
    );

    expect(result.outputTypes.get('income')?.get('default')).toBe('monthly-flow');
    expect(result.outputTypes.get('scalar')?.get('default')).toBe('scalar');
    expect(result.outputTypes.get('asset')).toEqual(
      new Map([
        ['balance', 'timeseries'],
        ['endingBalance', 'scalar'],
      ]),
    );
    expect(result.outputTypes.get('note')?.get('default')).toBe('none');
  });

  it('uses the same compatibility policy for editor validation and engine diagnostics', () => {
    const nodes: EconNodeData[] = [
      { id: 'income', label: 'Income', kind: 'income', baseValue: 10, timeUnit: 'per_month' },
      { id: 'value', label: 'Value', kind: 'value', baseValue: 10 },
      { id: 'assetA', label: 'Asset A', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
      { id: 'assetB', label: 'Asset B', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
      { id: 'target', label: 'Target', kind: 'output', targetAmount: 10 },
    ];
    const fixture = graph(nodes);
    const compatible = flow('income-asset', 'income', 'assetA');
    const targetSeries = flow('asset-target', 'assetA', 'target', { sourcePort: 'balance' });
    const chainedBalance = flow('asset-chain', 'assetA', 'assetB', { sourcePort: 'endingBalance' });
    const laggedScalar = { ...flow('value-asset', 'value', 'assetB'), weight: 1, lagMonths: 1 };

    expect(validateConnection(fixture, compatible, settings(12))).toMatchObject({ valid: true });
    expect(validateConnection(fixture, targetSeries, settings(12))).toMatchObject({ valid: true });
    expect(validateConnection(fixture, chainedBalance, settings(12))).toMatchObject({
      valid: false,
      reason: 'Assets require monthly-flow contributions, not scalar.',
    });
    expect(validateConnection(fixture, laggedScalar, settings(12))).toMatchObject({
      valid: false,
      reason: 'Scalar connections cannot be lagged.',
    });

    const result = compute(nodes, [chainedBalance], 12);
    expect(result.errors.assetB).toContain('Expected monthly-flow, received scalar');
  });
});

describe('approved financial time semantics', () => {
  it('applies interest to the opening balance before the end-of-month contribution', () => {
    const result = compute(
      [
        { id: 'flow', label: 'Flow', kind: 'income', baseValue: 10, timeUnit: 'per_month' },
        { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 100, interestRateAnnual: 0.12 },
      ],
      [flow('flow-asset', 'flow', 'asset')],
      1,
    );

    expect(requireNode(result, 'asset').timeseries).toEqual([111]);
  });

  it('allows negative rates and signed flows while rejecting negative authored expenses', () => {
    const negativeFlow = compute(
      [
        { id: 'withdrawal', label: 'Withdrawal', kind: 'income', baseValue: -10, timeUnit: 'per_month' },
        { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 100, interestRateAnnual: -0.12 },
      ],
      [flow('withdrawal-asset', 'withdrawal', 'asset')],
      2,
    );
    const negativeExpense = compute(
      [{ id: 'expense', label: 'Expense', kind: 'expense', baseValue: -1, timeUnit: 'per_month' }],
      [],
      2,
    );

    expect(requireNode(negativeFlow, 'asset').timeseries?.[0]).toBeCloseTo(89, 10);
    expect(requireNode(negativeFlow, 'asset').timeseries?.[1]).toBeCloseTo(78.11, 10);
    expect(negativeExpense.errors.expense).toContain('Expenses must be non-negative');
  });

  it('excludes month zero and handles final-month and after-horizon targets explicitly', () => {
    const result = compute(
      [
        { id: 'loss', label: 'Loss', kind: 'income', baseValue: -1, timeUnit: 'per_month' },
        { id: 'initial', label: 'Initial', kind: 'asset', initialBalance: 100, interestRateAnnual: 0 },
        { id: 'monthZero', label: 'Month zero', kind: 'output', targetAmount: 100 },
        { id: 'gain', label: 'Gain', kind: 'income', baseValue: 50, timeUnit: 'per_month' },
        { id: 'growth', label: 'Growth', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
        { id: 'finalMonth', label: 'Final month', kind: 'output', targetAmount: 150 },
        { id: 'afterHorizon', label: 'After horizon', kind: 'output', targetAmount: 151 },
      ],
      [
        flow('loss-initial', 'loss', 'initial'),
        flow('initial-month-zero', 'initial', 'monthZero', { sourcePort: 'balance' }),
        flow('gain-growth', 'gain', 'growth'),
        flow('growth-final', 'growth', 'finalMonth', { sourcePort: 'balance' }),
        flow('growth-after', 'growth', 'afterHorizon', { sourcePort: 'balance' }),
      ],
      3,
    );

    expect(requireNode(result, 'monthZero').outputState).toEqual({ kind: 'unreachable' });
    expect(requireNode(result, 'finalMonth').outputState).toEqual({ kind: 'month', month: 3 });
    expect(requireNode(result, 'afterHorizon').outputState).toEqual({ kind: 'unreachable' });
    expect(requireNode(result, 'growth').timeseries).toHaveLength(3);
  });

  it.each([1, 6, 24])('emits exactly the configured %i-month horizon', (horizon) => {
    const result = compute(
      [{ id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 5, interestRateAnnual: 0 }],
      [],
      horizon,
    );
    expect(requireNode(result, 'asset').timeseries).toHaveLength(horizon);
  });
});

describe('weighted, lagged, chained, and multi-output flows', () => {
  it('applies weight before lag to a monthly flow', () => {
    const edge = { ...flow('flow-asset', 'flow', 'asset'), weight: 0.5, lagMonths: 2 };
    const result = compute(
      [
        { id: 'flow', label: 'Flow', kind: 'income', baseValue: 100, timeUnit: 'per_month' },
        { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
      ],
      [edge],
      4,
    );

    expect(requireNode(result, 'asset').timeseries).toEqual([0, 0, 50, 100]);
  });

  it('applies weight and lag to timeseries before a boundary query', () => {
    const result = compute(
      [
        { id: 'flow', label: 'Flow', kind: 'income', baseValue: 100, timeUnit: 'per_month' },
        { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 0, interestRateAnnual: 0 },
        { id: 'target', label: 'Target', kind: 'output', targetAmount: 100 },
      ],
      [
        flow('flow-asset', 'flow', 'asset'),
        { ...flow('asset-target', 'asset', 'target', { sourcePort: 'balance' }), weight: 0.5, lagMonths: 1 },
      ],
      4,
    );

    expect(requireNode(result, 'target').outputState).toEqual({ kind: 'month', month: 3 });
  });

  it('keeps two custom outputs independently addressable in formulas', () => {
    const custom: EconNodeData = {
      id: 'box',
      label: 'Box',
      kind: 'custom',
      custom: {
        inputs: [{ id: 'in', label: 'Input', valueType: 'scalar' }],
        outputs: [
          { id: 'net-port', label: 'Net', valueType: 'scalar', formulaId: 'net' },
          { id: 'gross-port', label: 'Gross', valueType: 'scalar', formulaId: 'gross' },
        ],
        internalGraph: graph([
          { id: 'input', label: 'Input', kind: 'value', baseValue: 0 },
          { id: 'netValue', label: 'Net', kind: 'value', baseValue: 7 },
          { id: 'grossValue', label: 'Gross', kind: 'value', baseValue: 3 },
        ]),
        inputBindings: { in: 'input' },
        outputBindings: { 'net-port': 'netValue', 'gross-port': 'grossValue' },
      },
    };
    const result = compute(
      [
        { id: 'seed', label: 'Seed', kind: 'value', baseValue: 0 },
        custom,
        {
          id: 'formula',
          label: 'Formula',
          kind: 'calc',
          formula: 'box.net + box.gross',
          outputType: 'scalar',
        },
      ],
      [
        flow('seed-box', 'seed', 'box', { targetPort: 'in' }),
        flow('box-net-formula', 'box', 'formula', { sourcePort: 'net-port' }),
        flow('box-gross-formula', 'box', 'formula', { sourcePort: 'gross-port' }),
      ],
      12,
    );

    expect(result.errors).toEqual({});
    expect(requireNode(result, 'box').computedValue).toBeUndefined();
    expect(result.customOutputs.get('box')?.get('net-port')).toEqual({ type: 'scalar', value: 7 });
    expect(result.customOutputs.get('box')?.get('gross-port')).toEqual({ type: 'scalar', value: 3 });
    expect(requireNode(result, 'formula').computedValue).toBe(10);
  });

  it('carries an explicitly typed custom timeseries output without scalar reinterpretation', () => {
    const result = compute(
      [
        { id: 'seed', label: 'Seed', kind: 'value', baseValue: 0 },
        {
          id: 'custom',
          label: 'Custom asset',
          kind: 'custom',
          custom: {
            inputs: [{ id: 'in', label: 'Input', valueType: 'scalar' }],
            outputs: [{ id: 'series-port', label: 'Series', valueType: 'timeseries', formulaId: 'series' }],
            internalGraph: graph([
              { id: 'input', label: 'Input', kind: 'value', baseValue: 0 },
              { id: 'asset', label: 'Asset', kind: 'asset', initialBalance: 5, interestRateAnnual: 0 },
            ]),
            inputBindings: { in: 'input' },
            outputBindings: { 'series-port': 'asset' },
          },
        },
        { id: 'target', label: 'Target', kind: 'output', targetAmount: 5 },
      ],
      [
        flow('seed-custom', 'seed', 'custom', { targetPort: 'in' }),
        flow('custom-target', 'custom', 'target', { sourcePort: 'series-port' }),
      ],
      2,
    );

    expect(result.errors).toEqual({});
    expect(result.customOutputs.get('custom')?.get('series-port')).toEqual({
      type: 'timeseries',
      samples: [5, 5],
    });
    expect(requireNode(result, 'target').outputState).toEqual({ kind: 'month', month: 1 });
  });
});
