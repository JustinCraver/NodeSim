import { describe, expect, it } from 'vitest';
import { computeGraph } from '../src/engine/computeGraph';
import { computeFixture, flow, graph, requireNode } from './harness/graphHarness';

describe('full-consumption formula grammar', () => {
  it.each([
    ['.5 + .25', 0.75],
    ['max(1, -2)', 1],
    ['sum(1, 2, 3) / 2', 3],
    ['-(2 + 3) * 4', -20],
  ])('evaluates %s deterministically', (formula, expected) => {
    const result = computeFixture(
      graph([{ id: 'calc', label: 'Calc', kind: 'calc', formula, outputType: 'scalar' }]),
    );

    expect(result.errors).toEqual({});
    expect(requireNode(result, 'calc').computedValue).toBe(expected);
  });

  it.each([
    ['1$+2', 'Unexpected character "$" at position 1'],
    ['sum(1,,2)', 'Missing function argument'],
    ['sum()', 'Functions require at least one argument'],
    ['1 +', 'Invalid expression'],
    ['1.', 'Invalid number'],
    ['unknown(1)', 'Unsupported function: unknown'],
  ])('rejects malformed formula %s', (formula, message) => {
    const result = computeFixture(
      graph([{ id: 'calc', label: 'Calc', kind: 'calc', formula, outputType: 'scalar' }]),
    );

    expect(result.errors.calc).toContain(message);
    expect(requireNode(result, 'calc').computedValue).toBeUndefined();
  });

  it('rejects division by zero and overflow as structured finite-number failures', () => {
    const division = computeFixture(
      graph([{ id: 'calc', label: 'Calc', kind: 'calc', formula: '1 / 0', outputType: 'scalar' }]),
    );
    const overflowLiteral = '9'.repeat(400);
    const overflow = computeFixture(
      graph([{ id: 'calc', label: 'Calc', kind: 'calc', formula: overflowLiteral, outputType: 'scalar' }]),
    );

    expect(division.diagnostics[0]).toMatchObject({
      code: 'division_by_zero',
      nodeId: 'calc',
      graphPath: '/root',
      cause: 'Division by zero',
    });
    expect(overflow.errors.calc).toContain('Non-finite number');
  });

  it('keeps finite scalar arithmetic finite across a representative integer grid', () => {
    for (let left = -8; left <= 8; left += 1) {
      for (let right = -8; right <= 8; right += 1) {
        const formula = right === 0 ? 'left * right + 1' : '(left + right) / right';
        const result = computeFixture(
          graph(
            [
              { id: 'left', label: 'Left', kind: 'value', baseValue: left },
              { id: 'right', label: 'Right', kind: 'value', baseValue: right },
              { id: 'calc', label: 'Calc', kind: 'calc', formula, outputType: 'scalar' },
            ],
            [flow('left-calc', 'left', 'calc'), flow('right-calc', 'right', 'calc')],
          ),
        );

        expect(result.errors).toEqual({});
        expect(Number.isFinite(requireNode(result, 'calc').computedValue)).toBe(true);
      }
    }
  });
});

describe('component-scoped graph failures', () => {
  it('labels only cycle members, blocks their dependents, and computes unrelated nodes', () => {
    const result = computeFixture(
      graph(
        [
          { id: 'a', label: 'A', kind: 'value', baseValue: 1 },
          { id: 'b', label: 'B', kind: 'value', baseValue: 2 },
          { id: 'dependent', label: 'Dependent', kind: 'value', baseValue: 3 },
          { id: 'independent', label: 'Independent', kind: 'value', baseValue: 9 },
        ],
        [flow('a-b', 'a', 'b'), flow('b-a', 'b', 'a'), flow('a-dependent', 'a', 'dependent')],
      ),
    );

    expect(result.errors.a).toBe('Cycle detected in graph');
    expect(result.errors.b).toBe('Cycle detected in graph');
    expect(result.errors.dependent).toContain('Blocked by failed dependency: a');
    expect(result.errors.independent).toBeUndefined();
    expect(requireNode(result, 'independent').computedValue).toBe(9);
  });

  it('propagates a failed formula instead of substituting zero downstream', () => {
    const result = computeFixture(
      graph(
        [
          { id: 'bad', label: 'Bad', kind: 'calc', formula: '1 / 0', outputType: 'scalar' },
          { id: 'sink', label: 'Sink', kind: 'value', baseValue: 99 },
        ],
        [flow('bad-sink', 'bad', 'sink')],
      ),
    );

    expect(result.errors.bad).toBe('Division by zero');
    expect(result.errors.sink).toContain('Blocked by failed dependency: bad');
    expect(requireNode(result, 'sink').computedValue).toBeUndefined();
  });

  it('reports duplicate IDs and dangling endpoints without stopping unrelated computation', () => {
    const result = computeGraph(
      [
        { id: 'duplicate', label: 'First', kind: 'value', baseValue: 1 },
        { id: 'duplicate', label: 'Second', kind: 'value', baseValue: 2 },
        { id: 'sink', label: 'Sink', kind: 'value', baseValue: 3 },
        { id: 'independent', label: 'Independent', kind: 'value', baseValue: 4 },
      ],
      [flow('dangling', 'missing', 'sink')],
    );

    expect(result.errors.duplicate).toBe('Duplicate node id: duplicate');
    expect(result.errors.sink).toBe('Dangling connection dangling');
    expect(requireNode(result, 'independent').computedValue).toBe(4);
    expect(result.diagnostics.find((diagnostic) => diagnostic.edgeId === 'dangling')).toMatchObject({
      code: 'invalid_edge',
      graphPath: '/root',
      cause: 'Unknown source missing',
    });
  });

  it('retains the supplied graph path and original cause in diagnostics', () => {
    const result = computeGraph(
      [{ id: 'calc', label: 'Calc', kind: 'calc', formula: 'missing + 1', outputType: 'scalar' }],
      [],
      undefined,
      '/root/custom',
    );

    expect(result.diagnostics[0]).toMatchObject({
      nodeId: 'calc',
      graphPath: '/root/custom',
      message: 'Unknown variable: missing',
      cause: 'Unknown variable: missing',
    });
  });
});
