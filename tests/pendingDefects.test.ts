import { describe, it } from 'vitest';

describe('confirmed remediation targets', () => {
  it.todo('rejects unknown formula characters instead of evaluating `1$+2` as `3`');
  it.todo('accepts `.5 + .25` as `0.75`, or rejects leading decimals with an explicit grammar diagnostic');
  it.todo('rejects non-finite formula results instead of allowing `1 / 0` to serialize as `null`');
  it.todo('parses unary negatives in function arguments so `max(1, -2)` evaluates to `1`');
  it.todo('reports a cycle only on its members and blocked dependents, not independent nodes');
  it.todo('applies the approved edge weight and lag semantics instead of silently ignoring both fields');
  it.todo('persists the last valid authored document so edits survive reload');
  it.todo('exports the root document while the editor is displaying a custom-node scope');
  it.todo('validates an import completely before replacing the active document');
});
