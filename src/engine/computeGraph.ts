import { DEFAULT_SIMULATION_SETTINGS, MAX_HORIZON_MONTHS } from '../document/graphDocument';
import type {
  ComputeDiagnostic,
  ComputeDiagnosticCode,
  EconEdgeData,
  EconNodeData,
  FormulaValueType,
  GraphComputeResult,
  NumericRuntimeValue,
  RuntimeValue,
  SimulationSettingsV1,
  TimeUnit,
  ValueType,
} from '../models/types';
import { evaluateFormula } from './formula';

const TIME_UNIT_MULTIPLIERS: Record<TimeUnit, number> = {
  per_day: 30,
  per_week: 52 / 12,
  per_month: 1,
  per_year: 1 / 12,
};

class ComputationFailure extends Error {
  constructor(
    readonly code: ComputeDiagnosticCode,
    message: string,
    readonly cause?: string,
    readonly edgeId?: string,
    readonly portId?: string,
  ) {
    super(message);
    this.name = 'ComputationFailure';
  }
}

const fail = (
  code: ComputeDiagnosticCode,
  message: string,
  cause?: string,
  edgeId?: string,
  portId?: string,
): never => {
  throw new ComputationFailure(code, message, cause, edgeId, portId);
};

const assertFinite = (value: number, context: string) => {
  if (!Number.isFinite(value)) {
    fail('invalid_number', `${context} must be finite`, `Received ${String(value)}`);
  }
  return value;
};

const cloneValue = (value: RuntimeValue): RuntimeValue => {
  if (value.type === 'scalar') {
    return { type: 'scalar', value: value.value };
  }
  if (value.type === 'none') {
    return { type: 'none' };
  }
  return { type: value.type, samples: [...value.samples] };
};

const zeroValue = (type: Exclude<ValueType, 'none'>, horizon: number): NumericRuntimeValue =>
  type === 'scalar' ? { type, value: 0 } : { type, samples: Array.from({ length: horizon }, () => 0) };

const displayValue = (value: RuntimeValue) => {
  if (value.type === 'scalar') {
    return value.value;
  }
  if (value.type === 'monthly-flow') {
    return value.samples[0] ?? 0;
  }
  if (value.type === 'timeseries') {
    return value.samples[value.samples.length - 1];
  }
  return undefined;
};

const assertSamples = (samples: number[], horizon: number, context: string) => {
  if (samples.length !== horizon) {
    fail('simulation_error', `${context} must contain exactly ${horizon} samples`);
  }
  samples.forEach((sample, index) => assertFinite(sample, `${context}[${index}]`));
};

const sumValues = (
  values: RuntimeValue[],
  horizon: number,
  expectedType?: Exclude<ValueType, 'none'>,
): NumericRuntimeValue => {
  if (values.length === 0) {
    return zeroValue(expectedType ?? 'scalar', horizon);
  }
  const first = values[0];
  if (first.type === 'none') {
    fail('invalid_type', 'Presentation-only values cannot be aggregated');
  }
  if (expectedType && first.type !== expectedType) {
    fail('invalid_type', `Expected ${expectedType}, received ${first.type}`);
  }
  if (!values.every((value) => value.type === first.type)) {
    fail('invalid_type', 'Aggregated values must have matching types');
  }
  if (first.type === 'scalar') {
    const total = values.reduce(
      (sum, value) => sum + (value as Extract<RuntimeValue, { type: 'scalar' }>).value,
      0,
    );
    return { type: 'scalar', value: assertFinite(total, 'aggregated scalar') };
  }
  const seriesType = first.type as 'monthly-flow' | 'timeseries';
  const typedValues = values as Array<
    Extract<RuntimeValue, { type: 'monthly-flow' }> | Extract<RuntimeValue, { type: 'timeseries' }>
  >;
  typedValues.forEach((value) => assertSamples(value.samples, horizon, `aggregated ${seriesType}`));
  return {
    type: seriesType,
    samples: Array.from({ length: horizon }, (_, index) =>
      assertFinite(
        typedValues.reduce((sum, value) => sum + value.samples[index], 0),
        `aggregated ${seriesType}`,
      ),
    ),
  };
};

const applyEdgeTransform = (value: RuntimeValue, edge: EconEdgeData, horizon: number): RuntimeValue => {
  if (value.type === 'none') {
    fail('invalid_type', 'Text nodes cannot connect to computational inputs', undefined, edge.id);
  }
  const weight = edge.weight ?? 1;
  const lagMonths = edge.lagMonths ?? 0;
  if (!Number.isFinite(weight) || weight < 0) {
    fail('invalid_edge', 'Connection weight must be finite and non-negative', undefined, edge.id);
  }
  if (!Number.isInteger(lagMonths) || lagMonths < 0 || lagMonths > MAX_HORIZON_MONTHS) {
    fail(
      'invalid_edge',
      `Connection lagMonths must be an integer from 0 to ${MAX_HORIZON_MONTHS}`,
      undefined,
      edge.id,
    );
  }
  if (value.type === 'scalar') {
    if (lagMonths !== 0) {
      fail('invalid_edge', 'A scalar connection cannot have a non-zero lag', undefined, edge.id);
    }
    return { type: 'scalar', value: assertFinite(value.value * weight, `weight on ${edge.id}`) };
  }
  const seriesValue = value as
    | Extract<RuntimeValue, { type: 'monthly-flow' }>
    | Extract<RuntimeValue, { type: 'timeseries' }>;
  assertSamples(seriesValue.samples, horizon, `source of ${edge.id}`);
  const weighted = seriesValue.samples.map((sample) => assertFinite(sample * weight, `weight on ${edge.id}`));
  const shifted = Array.from({ length: horizon }, (_, index) => (index < lagMonths ? 0 : weighted[index - lagMonths]));
  return { type: seriesValue.type, samples: shifted };
};

const normalizeMonthlyValue = (value: number | undefined, unit: TimeUnit | undefined) => {
  const authored = assertFinite(value ?? 0, 'Authored monthly flow');
  const multiplier = TIME_UNIT_MULTIPLIERS[unit ?? 'per_month'];
  return assertFinite(authored * multiplier, 'Normalized monthly flow');
};

const getDefaultPair = (node: EconNodeData, fallback: { left: number; right: number }) => ({
  left: assertFinite(node.leftValue ?? fallback.left, `${node.id}.leftValue`),
  right: assertFinite(node.rightValue ?? fallback.right, `${node.id}.rightValue`),
});

const normalizeMathPort = (port?: string) => {
  if (port === 'left') {
    return '1';
  }
  if (port === 'right') {
    return '2';
  }
  return port;
};

type IncomingValue = { edge: EconEdgeData; value: RuntimeValue };

const splitBinaryInputs = (incoming: IncomingValue[]) => {
  const left: RuntimeValue[] = [];
  const right: RuntimeValue[] = [];
  const unassigned: RuntimeValue[] = [];
  incoming.forEach(({ edge, value }) => {
    const port = normalizeMathPort(edge.targetPort);
    if (port === '1') {
      left.push(value);
    } else if (port === '2') {
      right.push(value);
    } else {
      unassigned.push(value);
    }
  });
  if (left.length === 0 && right.length === 0) {
    if (unassigned.length > 0) {
      left.push(unassigned[0]);
      right.push(...unassigned.slice(1));
    }
  } else if (left.length === 0) {
    left.push(...unassigned);
  } else {
    right.push(...unassigned);
  }
  return { left, right };
};

const applyBinaryOperation = (
  kind: Extract<EconNodeData['kind'], 'add' | 'subtract' | 'multiply' | 'divide'>,
  left: NumericRuntimeValue,
  right: NumericRuntimeValue,
  horizon: number,
): NumericRuntimeValue => {
  if (kind === 'add' || kind === 'subtract') {
    if (left.type !== right.type) {
      fail('invalid_type', `${kind} requires matching input types; received ${left.type} and ${right.type}`);
    }
    const operation = kind === 'add' ? (a: number, b: number) => a + b : (a: number, b: number) => a - b;
    if (left.type === 'scalar' && right.type === 'scalar') {
      return { type: 'scalar', value: assertFinite(operation(left.value, right.value), kind) };
    }
    if (left.type === 'monthly-flow' && right.type === 'monthly-flow') {
      assertSamples(left.samples, horizon, `${kind} left`);
      assertSamples(right.samples, horizon, `${kind} right`);
      return {
        type: 'monthly-flow',
        samples: left.samples.map((sample, index) => assertFinite(operation(sample, right.samples[index]), kind)),
      };
    }
    fail('invalid_type', `${kind} does not support ${left.type}`);
  }
  if (kind === 'multiply') {
    if (left.type === 'scalar' && right.type === 'scalar') {
      return { type: 'scalar', value: assertFinite(left.value * right.value, 'multiply') };
    }
    if (left.type === 'scalar' && right.type === 'monthly-flow') {
      return {
        type: 'monthly-flow',
        samples: right.samples.map((sample) => assertFinite(left.value * sample, 'multiply')),
      };
    }
    if (left.type === 'monthly-flow' && right.type === 'scalar') {
      return {
        type: 'monthly-flow',
        samples: left.samples.map((sample) => assertFinite(sample * right.value, 'multiply')),
      };
    }
    fail('invalid_type', `multiply does not support ${left.type} × ${right.type}`);
  }
  if (right.type !== 'scalar') {
    return fail('invalid_type', 'divide requires a scalar divisor');
  }
  const divisor = right.value;
  if (divisor === 0) {
    fail('division_by_zero', 'Division by zero');
  }
  if (left.type === 'scalar') {
    return { type: 'scalar', value: assertFinite(left.value / divisor, 'divide') };
  }
  if (left.type === 'monthly-flow') {
    return {
      type: 'monthly-flow',
      samples: left.samples.map((sample) => assertFinite(sample / divisor, 'divide')),
    };
  }
  return fail('invalid_type', 'divide does not support timeseries inputs');
};

const findCycleMembers = (nodeIds: string[], edges: EconEdgeData[]) => {
  const adjacency = new Map(nodeIds.map((id) => [id, [] as string[]]));
  edges.forEach((edge) => adjacency.get(edge.source)?.push(edge.target));
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycleMembers = new Set<string>();

  const connect = (id: string) => {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const target of adjacency.get(id) ?? []) {
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(target)!));
      }
    }

    if (lowLinks.get(id) !== indices.get(id)) {
      return;
    }
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    if (component.length > 1 || (adjacency.get(id) ?? []).includes(id)) {
      component.forEach((componentId) => cycleMembers.add(componentId));
    }
  };

  nodeIds.forEach((id) => {
    if (!indices.has(id)) {
      connect(id);
    }
  });
  return cycleMembers;
};

const buildOrder = (nodeIds: string[], edges: EconEdgeData[], excluded: Set<string>) => {
  const included = nodeIds.filter((id) => !excluded.has(id));
  const inDegree = new Map(included.map((id) => [id, 0]));
  const outgoing = new Map(included.map((id) => [id, [] as string[]]));
  edges.forEach((edge) => {
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) {
      return;
    }
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });
  const queue = included.filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const id = queue[queueIndex];
    queueIndex += 1;
    order.push(id);
    (outgoing.get(id) ?? []).forEach((target) => {
      const next = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, next);
      if (next === 0) {
        queue.push(target);
      }
    });
  }
  return order;
};

const formulaVariableId = (sourceNode: EconNodeData, edge: EconEdgeData) => {
  if (sourceNode.kind === 'custom') {
    const port = sourceNode.custom?.outputs.find((candidate) => candidate.id === edge.sourcePort);
    return port
      ? sourceNode.custom?.outputs.length === 1
        ? sourceNode.id
        : `${sourceNode.id}.${port.formulaId ?? port.id}`
      : undefined;
  }
  if (sourceNode.kind === 'asset') {
    return edge.sourcePort ? `${sourceNode.id}.${edge.sourcePort}` : undefined;
  }
  return sourceNode.id;
};

const computeGraphInternal = (
  sourceNodes: EconNodeData[],
  edges: EconEdgeData[],
  settings: SimulationSettingsV1,
  graphPath: string,
  injectedValues = new Map<string, RuntimeValue>(),
): GraphComputeResult => {
  const horizon = settings.horizonMonths;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > MAX_HORIZON_MONTHS) {
    throw new Error(`simulation horizon must be an integer from 1 to ${MAX_HORIZON_MONTHS}`);
  }
  const nodes: EconNodeData[] = sourceNodes.map((source) => ({
    ...source,
    computedValue: undefined,
    timeseries: undefined,
    outputState: undefined,
    valueType: undefined,
  }));
  const diagnostics: ComputeDiagnostic[] = [];
  const errors: Record<string, string> = {};
  const nodeValues = new Map<string, RuntimeValue>();
  const outputTypes = new Map<string, Map<string, ValueType>>();
  const customOutputs = new Map<string, Map<string, RuntimeValue>>();

  const addDiagnostic = (diagnostic: ComputeDiagnostic) => {
    diagnostics.push(diagnostic);
    const key = diagnostic.nodeId ?? diagnostic.edgeId;
    if (key && errors[key] === undefined) {
      errors[key] = diagnostic.message;
    }
  };

  const counts = new Map<string, number>();
  nodes.forEach((node) => counts.set(node.id, (counts.get(node.id) ?? 0) + 1));
  counts.forEach((count, id) => {
    if (count > 1) {
      addDiagnostic({
        code: 'duplicate_id',
        nodeId: id,
        graphPath,
        message: `Duplicate node id: ${id}`,
        cause: `${count} nodes share this identity`,
      });
    }
  });
  const uniqueNodes = nodes.filter((node) => counts.get(node.id) === 1);
  const nodeMap = new Map(uniqueNodes.map((node) => [node.id, node]));
  const validEdges = edges.filter((edge) => {
    const sourceExists = nodeMap.has(edge.source);
    const targetExists = nodeMap.has(edge.target);
    if (!sourceExists || !targetExists) {
      addDiagnostic({
        code: 'invalid_edge',
        edgeId: edge.id,
        ...(targetExists ? { nodeId: edge.target } : {}),
        graphPath,
        message: `Dangling connection ${edge.id}`,
        cause: !sourceExists ? `Unknown source ${edge.source}` : `Unknown target ${edge.target}`,
      });
      return false;
    }
    return true;
  });

  const cycleMembers = findCycleMembers([...nodeMap.keys()], validEdges);
  cycleMembers.forEach((id) =>
    addDiagnostic({
      code: 'cycle_member',
      nodeId: id,
      graphPath,
      message: 'Cycle detected in graph',
      cause: `Node ${id} is a member of a strongly connected component`,
    }),
  );
  const order = buildOrder([...nodeMap.keys()], validEdges, cycleMembers);
  const incomingMap = new Map<string, EconEdgeData[]>();
  validEdges.forEach((edge) => incomingMap.set(edge.target, [...(incomingMap.get(edge.target) ?? []), edge]));

  const recordValue = (node: EconNodeData, value: RuntimeValue, ports?: Map<string, RuntimeValue>) => {
    nodeValues.set(node.id, cloneValue(value));
    node.valueType = value.type;
    node.computedValue = displayValue(value);
    if (value.type === 'timeseries') {
      node.timeseries = [...value.samples];
    }
    const outputMap = ports ?? new Map([['default', value]]);
    outputTypes.set(
      node.id,
      new Map([...outputMap].map(([portId, portValue]) => [portId, portValue.type])),
    );
  };

  const resolveSourceValue = (edge: EconEdgeData): RuntimeValue => {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) {
      return fail('invalid_edge', `Unknown source ${edge.source}`, undefined, edge.id);
    }
    if (errors[sourceNode.id]) {
      return fail('blocked_dependency', `Blocked by failed dependency: ${sourceNode.id}`, errors[sourceNode.id], edge.id);
    }
    let value: RuntimeValue | undefined;
    if (sourceNode.kind === 'custom') {
      const outputs = customOutputs.get(sourceNode.id);
      const declared = sourceNode.custom?.outputs ?? [];
      const portId = edge.sourcePort ?? (declared.length === 1 ? declared[0].id : undefined);
      if (!portId) {
        return fail('invalid_port', 'A multi-output custom connection must select a source port', undefined, edge.id);
      }
      value = outputs?.get(portId);
      if (!value) {
        return fail('invalid_port', `Unknown custom output port: ${portId}`, undefined, edge.id, portId);
      }
    } else if (sourceNode.kind === 'asset') {
      const sourcePort = edge.sourcePort ?? (nodeMap.get(edge.target)?.kind === 'output' ? 'balance' : 'endingBalance');
      if (sourcePort === 'balance') {
        if (!sourceNode.timeseries) {
          return fail('missing_value', 'Missing asset balance timeseries', undefined, edge.id);
        }
        value = { type: 'timeseries', samples: [...sourceNode.timeseries] };
      } else if (sourcePort === 'endingBalance') {
        const ending = nodeValues.get(sourceNode.id);
        value = ending?.type === 'scalar' ? ending : undefined;
      } else {
        return fail('invalid_port', `Unknown asset output port: ${sourcePort}`, undefined, edge.id, sourcePort);
      }
    } else {
      if (edge.sourcePort !== undefined) {
        return fail(
          'invalid_port',
          `${sourceNode.kind} has no named source ports`,
          `Port ${edge.sourcePort} is not declared by ${sourceNode.id}`,
          edge.id,
          edge.sourcePort,
        );
      }
      value = nodeValues.get(sourceNode.id);
    }
    if (!value) {
      return fail('missing_value', `Source ${sourceNode.id} produced no value`, undefined, edge.id);
    }
    return applyEdgeTransform(value, edge, horizon);
  };

  const getIncoming = (nodeId: string) =>
    (incomingMap.get(nodeId) ?? []).map((edge) => ({ edge, value: resolveSourceValue(edge) }));

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node || errors[node.id]) {
      continue;
    }
    try {
      const injected = injectedValues.get(node.id);
      if (injected) {
        recordValue(node, injected);
        continue;
      }
      const incoming = getIncoming(node.id);
      switch (node.kind) {
        case 'income':
        case 'expense': {
          if (incoming.length > 0) {
            fail('invalid_type', `${node.kind} nodes do not accept graph connections`);
          }
          if (node.kind === 'expense' && (node.baseValue ?? 0) < 0) {
            fail('invalid_number', 'Expenses must be non-negative monthly-flow magnitudes');
          }
          const amount = normalizeMonthlyValue(node.baseValue, node.timeUnit);
          recordValue(node, { type: 'monthly-flow', samples: Array.from({ length: horizon }, () => amount) });
          break;
        }
        case 'value': {
          const value =
            incoming.length > 0
              ? sumValues(
                  incoming.map((item) => item.value),
                  horizon,
                  'scalar',
                )
              : { type: 'scalar' as const, value: assertFinite(node.baseValue ?? 0, `${node.id}.baseValue`) };
          recordValue(node, value);
          break;
        }
        case 'add':
        case 'subtract':
        case 'multiply':
        case 'divide': {
          const split = splitBinaryInputs(incoming);
          const fallback = node.kind === 'multiply' || node.kind === 'divide' ? { left: 1, right: 1 } : { left: 0, right: 0 };
          const defaults = getDefaultPair(node, fallback);
          const left =
            split.left.length > 0
              ? sumValues(split.left, horizon)
              : ({ type: 'scalar', value: defaults.left } as const);
          const right =
            split.right.length > 0
              ? sumValues(split.right, horizon)
              : ({ type: 'scalar', value: defaults.right } as const);
          node.input1Value = split.left.length > 0 ? displayValue(left) : undefined;
          node.input2Value = split.right.length > 0 ? displayValue(right) : undefined;
          node.input1Connected = split.left.length > 0;
          node.input2Connected = split.right.length > 0;
          recordValue(node, applyBinaryOperation(node.kind, left, right, horizon));
          break;
        }
        case 'calc': {
          const formula = node.formula;
          if (!formula) {
            fail('formula_error', 'Missing formula');
          }
          const formulaText = formula as string;
          const variables: Record<string, Extract<RuntimeValue, { type: FormulaValueType }>> = {};
          incoming.forEach(({ edge, value }) => {
            const sourceNode = nodeMap.get(edge.source)!;
            const identifier =
              formulaVariableId(sourceNode, edge) ??
              fail('invalid_port', `Connection ${edge.id} has no formula identity`, undefined, edge.id);
            if (value.type !== 'scalar' && value.type !== 'monthly-flow') {
              fail('invalid_type', `Formula inputs cannot use ${value.type}`, undefined, edge.id);
            }
            const formulaValue = value as Extract<RuntimeValue, { type: 'scalar' | 'monthly-flow' }>;
            const existing = variables[identifier];
            variables[identifier] = existing
              ? (sumValues([existing, formulaValue], horizon) as Extract<RuntimeValue, { type: FormulaValueType }> )
              : formulaValue;
          });
          try {
            recordValue(node, evaluateFormula(formulaText, variables, node.outputType ?? 'scalar'));
          } catch (error) {
            const cause = error instanceof Error ? error.message : 'Invalid formula';
            if (cause === 'Division by zero') {
              fail('division_by_zero', cause, cause);
            }
            fail('formula_error', cause, cause);
          }
          break;
        }
        case 'asset': {
          const contribution = sumValues(
            incoming.map((item) => item.value),
            horizon,
            'monthly-flow',
          );
          if (contribution.type !== 'monthly-flow') {
            return fail('invalid_type', 'Asset contributions must be monthly-flow values');
          }
          const initialBalance = assertFinite(node.initialBalance ?? 0, `${node.id}.initialBalance`);
          if (initialBalance < 0) {
            fail('invalid_number', 'Asset initial balance must be non-negative');
          }
          const rate = assertFinite(node.interestRateAnnual ?? 0, `${node.id}.interestRateAnnual`);
          const monthlyRate = assertFinite(rate / 12, `${node.id}.monthlyRate`);
          const samples: number[] = [];
          let balance = initialBalance;
          for (let month = 0; month < horizon; month += 1) {
            balance = assertFinite(
              balance * (1 + monthlyRate) + contribution.samples[month],
              `${node.id}.month[${month + 1}]`,
            );
            samples.push(balance);
          }
          node.timeseries = samples;
          const endingBalance: RuntimeValue = { type: 'scalar', value: balance };
          const ports = new Map<string, RuntimeValue>([
            ['balance', { type: 'timeseries', samples }],
            ['endingBalance', endingBalance],
          ]);
          recordValue(node, endingBalance, ports);
          break;
        }
        case 'output': {
          const authoredTargetAmount = node.targetAmount;
          if (authoredTargetAmount === undefined) {
            fail('missing_value', 'Missing target amount');
          }
          const targetAmount = assertFinite(authoredTargetAmount as number, `${node.id}.targetAmount`);
          if (targetAmount < 0) {
            fail('invalid_number', 'Target amount must be non-negative');
          }
          if (incoming.length === 0) {
            fail('missing_value', 'Missing asset timeseries');
          }
          const combined = sumValues(
            incoming.map((item) => item.value),
            horizon,
            'timeseries',
          );
          if (combined.type !== 'timeseries') {
            return fail('invalid_type', 'Output inputs must be asset balance timeseries');
          }
          const index = combined.samples.findIndex((sample) => sample >= targetAmount);
          if (index === -1) {
            node.outputState = { kind: 'unreachable' };
            node.valueType = 'scalar';
            nodeValues.set(node.id, { type: 'none' });
            outputTypes.set(node.id, new Map([['default', 'scalar']]));
          } else {
            node.outputState = { kind: 'month', month: index + 1 };
            recordValue(node, { type: 'scalar', value: index + 1 });
          }
          break;
        }
        case 'custom': {
          const custom = node.custom ?? fail('missing_value', 'Missing custom config');
          if (custom.inputs.length === 0 || custom.outputs.length === 0) {
            fail('invalid_port', 'Custom nodes require at least one input and output port');
          }
          if (new Set(custom.inputs.map((port) => port.id)).size !== custom.inputs.length) {
            fail('invalid_port', 'Custom input port IDs must be unique');
          }
          if (new Set(custom.outputs.map((port) => port.id)).size !== custom.outputs.length) {
            fail('invalid_port', 'Custom output port IDs must be unique');
          }
          const formulaIds = custom.outputs.map((port) => port.formulaId ?? port.id);
          if (formulaIds.some((formulaId) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(formulaId))) {
            fail('invalid_port', 'Custom output formula identities must use formula identifier syntax');
          }
          if (new Set(formulaIds).size !== formulaIds.length) {
            fail('invalid_port', 'Custom output formula identities must be unique');
          }
          const internalNodeMap = new Map(custom.internalGraph.nodes.map((internal) => [internal.id, internal]));
          const totals = new Map<string, RuntimeValue[]>();
          incoming.forEach(({ edge, value }) => {
            const portId = edge.targetPort ?? (custom.inputs.length === 1 ? custom.inputs[0].id : undefined);
            const port =
              custom.inputs.find((candidate) => candidate.id === portId) ??
              fail('invalid_port', `Unknown custom input port: ${portId ?? '(missing)'}`, undefined, edge.id, portId);
            const expected = port.valueType ?? 'scalar';
            if (value.type !== expected) {
              fail(
                'invalid_type',
                `Custom input ${port.id} expects ${expected}, received ${value.type}`,
                undefined,
                edge.id,
                port.id,
              );
            }
            totals.set(port.id, [...(totals.get(port.id) ?? []), value]);
          });

          const overrides = new Map<string, RuntimeValue>();
          custom.inputs.forEach((port) => {
            const boundId =
              custom.inputBindings[port.id] ??
              fail('invalid_port', `Missing input binding for ${port.id}`, undefined, undefined, port.id);
            const type = (port.valueType ?? 'scalar') as Exclude<ValueType, 'none'>;
            const boundNode =
              internalNodeMap.get(boundId) ??
              fail('invalid_port', `Invalid input binding for ${port.id}`, `Unknown internal node ${boundId}`, undefined, port.id);
            if (boundNode.kind !== 'income' && boundNode.kind !== 'value') {
              fail('invalid_port', `Input binding ${port.id} must target income or value`, undefined, undefined, port.id);
            }
            const boundType = boundNode.kind === 'income' ? 'monthly-flow' : 'scalar';
            if (type !== boundType) {
              fail(
                'invalid_type',
                `Custom input ${port.id} declares ${type}, but ${boundId} is ${boundType}`,
                undefined,
                undefined,
                port.id,
              );
            }
            const value = sumValues(totals.get(port.id) ?? [], horizon, type);
            const existing = overrides.get(boundId);
            overrides.set(boundId, existing ? sumValues([existing, value], horizon, type) : value);
          });
          const internalResult = computeGraphInternal(
            custom.internalGraph.nodes.map((internal) => ({ ...internal })),
            custom.internalGraph.edges.map((internal) => ({ ...internal })),
            settings,
            `${graphPath}/${node.id}`,
            overrides,
          );
          diagnostics.push(...internalResult.diagnostics);
          if (internalResult.diagnostics.length > 0) {
            const first = internalResult.diagnostics[0];
            fail('blocked_dependency', 'Internal graph errors', first.message);
          }
          const outputs = new Map<string, RuntimeValue>();
          custom.outputs.forEach((port) => {
            const boundId =
              custom.outputBindings[port.id] ??
              fail('invalid_port', `Missing output binding for ${port.id}`, undefined, undefined, port.id);
            const boundNode =
              internalResult.nodes.find((candidate) => candidate.id === boundId) ??
              fail('invalid_port', `Invalid output binding for ${port.id}`, `Unknown internal node ${boundId}`, undefined, port.id);
            let value = internalResult.nodeValues.get(boundId);
            if (boundNode.kind === 'asset' && port.valueType === 'timeseries' && boundNode.timeseries) {
              value = { type: 'timeseries', samples: [...boundNode.timeseries] };
            }
            if (boundNode.kind === 'custom') {
              const nestedOutputs = internalResult.customOutputs.get(boundId);
              const matches = [...(nestedOutputs?.values() ?? [])].filter(
                (candidate) => candidate.type === (port.valueType ?? 'scalar'),
              );
              if (matches.length === 1) {
                value = matches[0];
              }
            }
            if (!value || value.type === 'none') {
              return fail('missing_value', `Output binding ${port.id} produced no value`);
            }
            const expected = port.valueType ?? 'scalar';
            if (value.type !== expected) {
              fail(
                'invalid_type',
                `Custom output ${port.id} declares ${expected}, received ${value.type}`,
                undefined,
                undefined,
                port.id,
              );
            }
            outputs.set(port.id, cloneValue(value));
          });
          customOutputs.set(node.id, outputs);
          if (outputs.size === 1) {
            recordValue(node, outputs.values().next().value as RuntimeValue, outputs);
          } else {
            node.valueType = undefined;
            node.computedValue = undefined;
            nodeValues.set(node.id, { type: 'none' });
            outputTypes.set(
              node.id,
              new Map([...outputs].map(([portId, value]) => [portId, value.type])),
            );
          }
          break;
        }
        case 'text':
          if (incoming.length > 0) {
            fail('invalid_type', 'Text nodes cannot accept computational inputs');
          }
          recordValue(node, { type: 'none' });
          break;
      }
    } catch (error) {
      const failure =
        error instanceof ComputationFailure
          ? error
          : new ComputationFailure(
              'simulation_error',
              error instanceof Error ? error.message : 'Calculation error',
            );
      addDiagnostic({
        code: failure.code,
        nodeId: node.id,
        ...(failure.edgeId ? { edgeId: failure.edgeId } : {}),
        ...(failure.portId ? { portId: failure.portId } : {}),
        graphPath,
        message: failure.message,
        ...(failure.cause ? { cause: failure.cause } : {}),
      });
      node.computedValue = undefined;
      node.timeseries = undefined;
      node.outputState = undefined;
      nodeValues.delete(node.id);
      outputTypes.delete(node.id);
    }
  }

  return { nodes, errors, diagnostics, nodeValues, outputTypes, customOutputs };
};

export const computeGraph = (
  nodes: EconNodeData[],
  edges: EconEdgeData[],
  settings: SimulationSettingsV1 = DEFAULT_SIMULATION_SETTINGS,
  graphPath = '/root',
): GraphComputeResult => computeGraphInternal(nodes, edges, settings, graphPath);
