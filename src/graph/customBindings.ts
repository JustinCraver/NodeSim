import type {
  ComputeDiagnostic,
  CustomNodeConfig,
  EconNodeData,
  GraphData,
  ValueType,
} from '../models/types';

type ComputationalValueType = Exclude<ValueType, 'none'>;

export type CustomBindingRepairResult = {
  custom: CustomNodeConfig;
  repairedPortIds: string[];
  unresolvedDiagnostics: ComputeDiagnostic[];
};

const nodeOutputTypes = (node: EconNodeData): ComputationalValueType[] => {
  switch (node.kind) {
    case 'income':
    case 'expense':
      return ['monthly-flow'];
    case 'value':
    case 'output':
      return ['scalar'];
    case 'calc':
      return [node.outputType ?? 'scalar'];
    case 'asset':
      return ['scalar', 'timeseries'];
    case 'custom':
      return [
        ...new Set(
          (node.custom?.outputs ?? [])
            .map((port) => port.valueType ?? 'scalar')
            .filter((valueType): valueType is ComputationalValueType => valueType !== 'none'),
        ),
      ];
    case 'text':
      return [];
    default:
      return node.valueType && node.valueType !== 'none' ? [node.valueType] : ['scalar'];
  }
};

export const getCompatibleInputBindingNodes = (
  graph: GraphData,
  valueType: ValueType,
) => valueType === 'none'
  ? []
  : graph.nodes.filter(
      (node) => (node.kind === 'income' || node.kind === 'value') && nodeOutputTypes(node).includes(valueType),
    );

export const getCompatibleOutputBindingNodes = (
  graph: GraphData,
  valueType: ValueType,
) => valueType === 'none'
  ? []
  : graph.nodes.filter((node) => {
      if (node.kind === 'custom') {
        return (node.custom?.outputs ?? []).filter((port) => (port.valueType ?? 'scalar') === valueType).length === 1;
      }
      return nodeOutputTypes(node).includes(valueType);
    });

export const diagnoseCustomBindings = (
  custom: CustomNodeConfig,
  graphPath: string,
  customNodeId: string,
): ComputeDiagnostic[] => {
  const nodeMap = new Map(custom.internalGraph.nodes.map((node) => [node.id, node]));
  const diagnostics: ComputeDiagnostic[] = [];
  custom.inputs.forEach((port) => {
    const boundId = custom.inputBindings[port.id];
    const boundNode = boundId ? nodeMap.get(boundId) : undefined;
    const valueType = port.valueType ?? 'scalar';
    if (!boundNode) {
      diagnostics.push({
        code: 'invalid_port',
        graphPath,
        nodeId: customNodeId,
        portId: port.id,
        message: `Invalid input binding for ${port.id}`,
        cause: boundId ? `Unknown internal node ${boundId}` : 'Binding is empty',
      });
    } else if (!getCompatibleInputBindingNodes(custom.internalGraph, valueType).includes(boundNode)) {
      diagnostics.push({
        code: 'invalid_type',
        graphPath,
        nodeId: customNodeId,
        portId: port.id,
        message: `Incompatible input binding for ${port.id}`,
        cause: `${boundNode.id} cannot receive ${valueType}`,
      });
    }
  });
  custom.outputs.forEach((port) => {
    const boundId = custom.outputBindings[port.id];
    const boundNode = boundId ? nodeMap.get(boundId) : undefined;
    const valueType = port.valueType ?? 'scalar';
    if (!boundNode) {
      diagnostics.push({
        code: 'invalid_port',
        graphPath,
        nodeId: customNodeId,
        portId: port.id,
        message: `Invalid output binding for ${port.id}`,
        cause: boundId ? `Unknown internal node ${boundId}` : 'Binding is empty',
      });
    } else if (!getCompatibleOutputBindingNodes(custom.internalGraph, valueType).includes(boundNode)) {
      diagnostics.push({
        code: 'invalid_type',
        graphPath,
        nodeId: customNodeId,
        portId: port.id,
        message: `Incompatible output binding for ${port.id}`,
        cause: `${boundNode.id} does not produce ${valueType}`,
      });
    }
  });
  return diagnostics;
};

const nextAvailableId = (graph: GraphData, preferred: string) => {
  const ids = new Set(graph.nodes.map((node) => node.id));
  let candidate = preferred;
  let sequence = 2;
  while (ids.has(candidate)) {
    candidate = `${preferred}-${sequence}`;
    sequence += 1;
  }
  return candidate;
};

const createPlaceholder = (
  graph: GraphData,
  preferredId: string,
  label: string,
  valueType: ValueType,
  bindingKind: 'input' | 'output',
): EconNodeData | undefined => {
  const id = nextAvailableId(graph, preferredId);
  if (valueType === 'scalar') {
    return { id, label, kind: 'value', baseValue: 0 };
  }
  if (valueType === 'monthly-flow') {
    return { id, label, kind: 'income', baseValue: 0, timeUnit: 'per_month' };
  }
  if (valueType === 'timeseries') {
    return bindingKind === 'output'
      ? { id, label, kind: 'asset', initialBalance: 0, interestRateAnnual: 0 }
      : undefined;
  }
  return undefined;
};

export const repairCustomBindings = (
  custom: CustomNodeConfig,
  graphPath: string,
  customNodeId: string,
): CustomBindingRepairResult => {
  const next = structuredClone(custom);
  const repairedPortIds: string[] = [];
  const initialDiagnostics = diagnoseCustomBindings(next, graphPath, customNodeId);
  initialDiagnostics.forEach((diagnostic) => {
    if (!diagnostic.portId) {
      return;
    }
    const isOutputDiagnostic = diagnostic.message.includes('output binding');
    const input = isOutputDiagnostic ? undefined : next.inputs.find((port) => port.id === diagnostic.portId);
    const output = isOutputDiagnostic ? next.outputs.find((port) => port.id === diagnostic.portId) : undefined;
    const port = input ?? output;
    if (!port) {
      return;
    }
    const placeholder = createPlaceholder(
      next.internalGraph,
      `repair-${input ? 'input' : 'output'}-${port.id}`,
      `${port.label || port.id} repair placeholder`,
      port.valueType ?? 'scalar',
      input ? 'input' : 'output',
    );
    if (!placeholder) {
      return;
    }
    next.internalGraph.nodes.push(placeholder);
    if (input) {
      next.inputBindings[port.id] = placeholder.id;
    } else {
      next.outputBindings[port.id] = placeholder.id;
    }
    repairedPortIds.push(port.id);
  });
  return {
    custom: next,
    repairedPortIds,
    unresolvedDiagnostics: diagnoseCustomBindings(next, graphPath, customNodeId),
  };
};
