import { describe, expect, it } from 'vitest';
import demoGraph from '../src/demo/houseFund.json';
import type { GraphData } from '../src/models/types';
import { computeMigratedFixture, jsonRoundTrip, requireNode } from './harness/graphHarness';

const houseFundFixture = demoGraph as GraphData;

describe('current house-fund demo', () => {
  it('retains the approved monthly values and target month', () => {
    const result = computeMigratedFixture(houseFundFixture);

    expect(result.errors).toEqual({});
    expect(requireNode(result, 'netIncome').computedValue).toBe(4_000);
    expect(requireNode(result, 'fixedExpenses').computedValue).toBe(2_500);
    expect(requireNode(result, 'monthlySavings').computedValue).toBe(1_500);
    expect(requireNode(result, 'savingsAdjuster').computedValue).toBe(1_350);
    expect(result.customOutputs.get('savingsAdjuster')?.get('out-1')).toEqual({
      type: 'monthly-flow',
      samples: Array.from({ length: 120 }, () => 1_350),
    });
    expect(requireNode(result, 'houseFund').timeseries).toHaveLength(120);
    expect(requireNode(result, 'monthsToDownPayment').computedValue).toBe(43);
  });

  it('round-trips the checked-in JSON fixture without changing computation', () => {
    const roundTripped = jsonRoundTrip(houseFundFixture);
    const before = computeMigratedFixture(houseFundFixture);
    const after = computeMigratedFixture(roundTripped);

    expect(roundTripped).toEqual(houseFundFixture);
    expect(after.errors).toEqual(before.errors);
    expect(requireNode(after, 'monthlySavings').computedValue).toBe(
      requireNode(before, 'monthlySavings').computedValue,
    );
    expect(requireNode(after, 'monthsToDownPayment').computedValue).toBe(
      requireNode(before, 'monthsToDownPayment').computedValue,
    );
  });
});
