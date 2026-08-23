import type {
  EconEdgeData,
  EconNodeData,
  GraphData,
  GraphComputeResult,
  SimulationSettingsV1,
  ValueType,
} from '../models/types';
import { MAX_HORIZON_MONTHS } from '../document/graphDocument';
import { computeGraph } from './computeGraph';

export type ConnectionValidation = { valid: true; valueType: ValueType } | { valid: false; reason: string };

const sourceType = (
  source: EconNodeData,
  edge: EconEdgeData,
  result: GraphComputeResult,
): ValueType | undefined => {
  if (source.kind === 'income' || source.kind === 'expense') {
    return 'monthly-flow';
  }
  if (source.kind === 'value' || source.kind === 'output') {
    return 'scalar';
  }
  if (source.kind === 'calc') {
    return source.outputType ?? 'scalar';
  }
  if (source.kind === 'asset') {
    return edge.sourcePort === 'balance' ? 'timeseries' : edge.sourcePort === 'endingBalance' ? 'scalar' : undefined;
  }
  if (source.kind === 'custom') {
    return source.custom?.outputs.find((port) => port.id === edge.sourcePort)?.valueType;
  }
  if (source.kind === 'text') {
    return 'none';
  }
  return result.outputTypes.get(source.id)?.get('default');
};

const existingPortTypes = (
  graph: GraphData,
  targetId: string,
  targetPort: string,
  result: GraphComputeResult,
) =>
  graph.edges
    .filter((edge) => edge.target === targetId && (edge.targetPort ?? '') === targetPort)
    .map((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.source);
      return source ? sourceType(source, edge, result) : undefined;
    })
    .filter((type): type is ValueType => Boolean(type));

export const validateConnection = (
  graph: GraphData,
  edge: EconEdgeData,
  settings?: SimulationSettingsV1,
): ConnectionValidation => {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target) {
    return { valid: false, reason: 'Connection endpoints must exist.' };
  }
  if (source.id === target.id) {
    return { valid: false, reason: 'A node cannot connect to itself.' };
  }
  if (!Number.isFinite(edge.weight ?? 1) || (edge.weight ?? 1) < 0) {
    return { valid: false, reason: 'Weight must be finite and non-negative.' };
  }
  if (
    !Number.isInteger(edge.lagMonths ?? 0) ||
    (edge.lagMonths ?? 0) < 0 ||
    (edge.lagMonths ?? 0) > MAX_HORIZON_MONTHS
  ) {
    return { valid: false, reason: `Lag must be an integer from 0 to ${MAX_HORIZON_MONTHS}.` };
  }

  const result = computeGraph(graph.nodes, graph.edges, settings);
  const valueType = sourceType(source, edge, result);
  if (!valueType) {
    return { valid: false, reason: 'Select an explicit source output port.' };
  }
  if (valueType === 'none') {
    return { valid: false, reason: 'Presentation-only nodes cannot create computational connections.' };
  }
  if (valueType === 'scalar' && (edge.lagMonths ?? 0) !== 0) {
    return { valid: false, reason: 'Scalar connections cannot be lagged.' };
  }

  if (target.kind === 'income' || target.kind === 'expense' || target.kind === 'text') {
    return { valid: false, reason: `${target.kind} nodes do not accept computational connections.` };
  }
  if (target.kind === 'value' && valueType !== 'scalar') {
    return { valid: false, reason: `Value nodes require scalar input, not ${valueType}.` };
  }
  if (target.kind === 'asset' && valueType !== 'monthly-flow') {
    return { valid: false, reason: `Assets require monthly-flow contributions, not ${valueType}.` };
  }
  if (target.kind === 'output' && valueType !== 'timeseries') {
    return { valid: false, reason: `Targets require asset balance timeseries, not ${valueType}.` };
  }
  if (target.kind === 'custom') {
    const port = target.custom?.inputs.find((candidate) => candidate.id === edge.targetPort);
    if (!port) {
      return { valid: false, reason: 'Select an explicit custom input port.' };
    }
    if ((port.valueType ?? 'scalar') !== valueType) {
      return {
        valid: false,
        reason: `${port.label} expects ${port.valueType ?? 'scalar'}, not ${valueType}.`,
      };
    }
  }
  if (target.kind === 'calc' && valueType === 'timeseries') {
    return { valid: false, reason: 'Formula nodes do not support implicit timeseries arithmetic.' };
  }

  if (
    target.kind === 'add' ||
    target.kind === 'subtract' ||
    target.kind === 'multiply' ||
    target.kind === 'divide'
  ) {
    const port = edge.targetPort === 'left' ? '1' : edge.targetPort === 'right' ? '2' : edge.targetPort;
    if (port !== '1' && port !== '2') {
      return { valid: false, reason: 'Select binary input 1 or 2.' };
    }
    if (valueType === 'timeseries') {
      return { valid: false, reason: 'Binary nodes do not support implicit timeseries arithmetic.' };
    }
    const samePortTypes = existingPortTypes(graph, target.id, port, result);
    if (samePortTypes.some((type) => type !== valueType)) {
      return { valid: false, reason: 'Values aggregated on one input port must have matching types.' };
    }
    const otherPort = port === '1' ? '2' : '1';
    const otherTypes = existingPortTypes(graph, target.id, otherPort, result);
    const otherType = otherTypes[0];
    if ((target.kind === 'add' || target.kind === 'subtract') && otherType && otherType !== valueType) {
      return { valid: false, reason: `${target.kind} requires matching input types.` };
    }
    if (target.kind === 'multiply' && otherType === 'monthly-flow' && valueType === 'monthly-flow') {
      return { valid: false, reason: 'Multiply requires one scalar when a monthly flow is connected.' };
    }
    if (target.kind === 'divide' && port === '2' && valueType !== 'scalar') {
      return { valid: false, reason: 'Divide requires a scalar divisor.' };
    }
    if (target.kind === 'divide' && port === '1' && otherType && otherType !== 'scalar') {
      return { valid: false, reason: 'Divide requires a scalar divisor.' };
    }
  }

  return { valid: true, valueType };
};
