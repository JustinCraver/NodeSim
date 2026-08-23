import { inferFormulaType } from '../engine/formula';
import type {
  AuthoredCustomNodeConfig,
  AuthoredEdgeData,
  AuthoredGraphData,
  AuthoredInputPortDef,
  AuthoredNodeData,
  AuthoredOutputPortDef,
  EconEdgeData,
  EconNodeData,
  FormulaValueType,
  GraphData,
  GraphDocument,
  SimulationSettingsV1,
  TimeUnit,
  ValueType,
} from '../models/types';

export const GRAPH_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_GRAPH_NODES = 1_000;
export const MAX_GRAPH_EDGES = 5_000;
export const MAX_NESTING_DEPTH = 8;
export const MAX_FORMULA_LENGTH = 4_096;
export const MAX_HORIZON_MONTHS = 1_200;

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettingsV1 = {
  version: 1,
  horizonMonths: 120,
  contributionTiming: 'end-of-month',
  annualRateConvention: 'nominal-divided-by-12',
  monthZero: 'initial-balance',
};

const NODE_KINDS = new Set([
  'income',
  'expense',
  'value',
  'add',
  'subtract',
  'multiply',
  'divide',
  'calc',
  'asset',
  'output',
  'custom',
  'text',
]);
const TIME_UNITS = new Set<TimeUnit>(['per_day', 'per_week', 'per_month', 'per_year']);
const VALUE_TYPES = new Set<ValueType>(['scalar', 'monthly-flow', 'timeseries', 'none']);
const FORMULA_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class GraphDocumentError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = 'GraphDocumentError';
  }
}

const fail = (path: string, reason: string): never => {
  throw new GraphDocumentError(path, reason);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readRecord = (value: unknown, path: string): Record<string, unknown> =>
  isRecord(value) ? value : fail(path, 'must be an object');

const readArray = (value: unknown, path: string): unknown[] =>
  Array.isArray(value) ? value : fail(path, 'must be an array');

const readString = (value: unknown, path: string, maximumLength = 256): string => {
  if (typeof value !== 'string' || value.length === 0) {
    fail(path, 'must be a non-empty string');
  }
  const stringValue = value as string;
  if (stringValue.length > maximumLength) {
    fail(path, `must be at most ${maximumLength} characters`);
  }
  return stringValue;
};

const readText = (value: unknown, path: string, maximumLength: number): string => {
  if (typeof value !== 'string') {
    fail(path, 'must be a string');
  }
  const text = value as string;
  if (text.length > maximumLength) {
    fail(path, `must be at most ${maximumLength} characters`);
  }
  return text;
};

const readFiniteNumber = (value: unknown, path: string, fallback?: number): number => {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    fail(path, 'must be a finite number');
  }
  return candidate as number;
};

const readNonNegativeNumber = (value: unknown, path: string, fallback?: number): number => {
  const candidate = readFiniteNumber(value, path, fallback);
  if (candidate < 0) {
    fail(path, 'must be non-negative');
  }
  return candidate;
};

const readInteger = (
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number => {
  const candidate = readFiniteNumber(value, path, fallback);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    fail(path, `must be an integer from ${minimum} to ${maximum}`);
  }
  return candidate;
};

const readOptionalPosition = (value: unknown, path: string): { x: number; y: number } | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const position = readRecord(value, path);
  return {
    x: readFiniteNumber(position.x, `${path}.x`),
    y: readFiniteNumber(position.y, `${path}.y`),
  };
};

const commonNodeFields = (node: Record<string, unknown>, path: string) => ({
  id: readString(node.id, `${path}.id`, 128),
  label: readText(node.label, `${path}.label`, 512),
  ...(node.position === undefined ? {} : { position: readOptionalPosition(node.position, `${path}.position`) }),
});

const formulaSafeId = (value: string, fallback: string, used: Set<string>) => {
  let candidate = value.replace(/[^A-Za-z0-9_]/g, '_');
  if (!candidate || !isNaN(Number(candidate[0]))) {
    candidate = fallback;
  }
  if (!FORMULA_IDENTIFIER.test(candidate)) {
    candidate = fallback;
  }
  let unique = candidate;
  let sequence = 2;
  while (used.has(unique)) {
    unique = `${candidate}_${sequence}`;
    sequence += 1;
  }
  used.add(unique);
  return unique;
};

const getRuntimeNodeOutputType = (
  graph: AuthoredGraphData,
  nodeId: string,
  sourcePort?: string,
  visiting = new Set<string>(),
): ValueType | undefined => {
  if (visiting.has(nodeId)) {
    return undefined;
  }
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return undefined;
  }
  switch (node.kind) {
    case 'income':
    case 'expense':
      return 'monthly-flow';
    case 'value':
    case 'output':
      return 'scalar';
    case 'calc':
      return node.outputType;
    case 'asset':
      return sourcePort === 'balance' ? 'timeseries' : 'scalar';
    case 'custom':
      return sourcePort
        ? node.custom.outputs.find((port) => port.id === sourcePort)?.valueType
        : node.custom.outputs.length === 1
          ? node.custom.outputs[0].valueType
          : undefined;
    case 'text':
      return 'none';
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      const nextVisiting = new Set(visiting).add(nodeId);
      const inputTypes = graph.edges
        .filter((edge) => edge.target === nodeId)
        .map((edge) => getRuntimeNodeOutputType(graph, edge.source, edge.sourcePort, nextVisiting))
        .filter((type): type is ValueType => Boolean(type));
      if (inputTypes.length === 0) {
        return 'scalar';
      }
      if (node.kind === 'add' || node.kind === 'subtract') {
        return inputTypes.every((type) => type === inputTypes[0]) ? inputTypes[0] : undefined;
      }
      if (node.kind === 'multiply') {
        return inputTypes.includes('monthly-flow') && inputTypes.every((type) => type !== 'timeseries')
          ? 'monthly-flow'
          : inputTypes.every((type) => type === 'scalar')
            ? 'scalar'
            : undefined;
      }
      return inputTypes[0] === 'monthly-flow' && inputTypes.slice(1).every((type) => type === 'scalar')
        ? 'monthly-flow'
        : inputTypes.every((type) => type === 'scalar')
          ? 'scalar'
          : undefined;
    }
  }
};

const formulaVariableId = (graph: AuthoredGraphData, edge: AuthoredEdgeData) => {
  const source = graph.nodes.find((node) => node.id === edge.source);
  if (!source) {
    return undefined;
  }
  if (source.kind === 'custom') {
    const port = source.custom.outputs.find((candidate) => candidate.id === edge.sourcePort);
    return port
      ? source.custom.outputs.length === 1
        ? source.id
        : `${source.id}.${port.formulaId}`
      : undefined;
  }
  if (source.kind === 'asset') {
    return edge.sourcePort ? `${source.id}.${edge.sourcePort}` : undefined;
  }
  return FORMULA_IDENTIFIER.test(source.id) ? source.id : undefined;
};

const inferLegacyFormulaTypes = (graph: AuthoredGraphData, explicitFormulaTypes: Set<string>) => {
  for (let pass = 0; pass < graph.nodes.length + 1; pass += 1) {
    let changed = false;
    graph.nodes.forEach((node) => {
      if (node.kind !== 'calc' || explicitFormulaTypes.has(node.id)) {
        return;
      }
      const variables: Record<string, FormulaValueType> = {};
      for (const edge of graph.edges.filter((candidate) => candidate.target === node.id)) {
        const identifier = formulaVariableId(graph, edge);
        const valueType = getRuntimeNodeOutputType(graph, edge.source, edge.sourcePort);
        if (!identifier || (valueType !== 'scalar' && valueType !== 'monthly-flow')) {
          return;
        }
        variables[identifier] = valueType;
      }
      try {
        const inferred = inferFormulaType(node.formula, variables);
        if (node.outputType !== inferred) {
          node.outputType = inferred;
          changed = true;
        }
      } catch {
        // Unsafe or invalid legacy formulas retain the documented scalar default.
      }
    });
    if (!changed) {
      break;
    }
  }
};

const migrateLegacyFormulaReferences = (graph: AuthoredGraphData) => {
  graph.nodes.forEach((node) => {
    if (node.kind !== 'calc') {
      return;
    }
    let formula = node.formula;
    graph.edges
      .filter((edge) => edge.target === node.id)
      .forEach((edge) => {
        const source = graph.nodes.find((candidate) => candidate.id === edge.source);
        if (!source || !FORMULA_IDENTIFIER.test(source.id)) {
          return;
        }
        let qualified: string | undefined;
        if (source.kind === 'asset' && edge.sourcePort) {
          qualified = `${source.id}.${edge.sourcePort}`;
        } else if (source.kind === 'custom' && source.custom.outputs.length > 1) {
          const port = source.custom.outputs.find((candidate) => candidate.id === edge.sourcePort);
          qualified = port ? `${source.id}.${port.formulaId}` : undefined;
        }
        if (!qualified) {
          return;
        }
        const escaped = source.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        formula = formula.replace(
          new RegExp(`(^|[^A-Za-z0-9_.])${escaped}(?=$|[^A-Za-z0-9_.])`, 'g'),
          `$1${qualified}`,
        );
      });
    node.formula = formula;
  });
};

const migratePorts = (
  rawPorts: unknown,
  path: string,
  legacy: boolean,
  isOutput: boolean,
): (AuthoredInputPortDef | AuthoredOutputPortDef)[] => {
  const ports = readArray(rawPorts, path);
  const ids = new Set<string>();
  const formulaIds = new Set<string>();
  return ports.map((rawPort, index) => {
    const portPath = `${path}[${index}]`;
    const port = readRecord(rawPort, portPath);
    const id = readString(port.id, `${portPath}.id`, 128);
    if (ids.has(id)) {
      fail(`${portPath}.id`, `duplicate port id ${id}`);
    }
    ids.add(id);
    const valueType = VALUE_TYPES.has(port.valueType as ValueType)
      ? (port.valueType as ValueType)
      : legacy
        ? 'scalar'
        : fail(`${portPath}.valueType`, 'must be scalar, monthly-flow, or timeseries');
    if (valueType === 'none') {
      fail(`${portPath}.valueType`, 'custom computational ports cannot use none');
    }
    const computationalType = valueType as Exclude<ValueType, 'none'>;
    const base = {
      id,
      label: readText(port.label, `${portPath}.label`, 256),
      valueType: computationalType,
    };
    if (!isOutput) {
      return base;
    }
    if (!legacy && typeof port.formulaId === 'string' && formulaIds.has(port.formulaId)) {
      fail(`${portPath}.formulaId`, `duplicate formula identifier ${port.formulaId}`);
    }
    const formulaId =
      typeof port.formulaId === 'string' && FORMULA_IDENTIFIER.test(port.formulaId)
        ? formulaSafeId(port.formulaId, `output_${index + 1}`, formulaIds)
        : legacy
          ? formulaSafeId(id, `output_${index + 1}`, formulaIds)
          : fail(`${portPath}.formulaId`, 'must be a formula identifier');
    return { ...base, formulaId };
  });
};

const migrateGraph = (rawGraph: unknown, path: string, depth: number, legacy: boolean): AuthoredGraphData => {
  if (depth > MAX_NESTING_DEPTH) {
    fail(path, `nesting depth exceeds ${MAX_NESTING_DEPTH}`);
  }
  const graph = readRecord(rawGraph, path);
  const rawNodes = readArray(graph.nodes, `${path}.nodes`);
  const rawEdges = readArray(graph.edges, `${path}.edges`);
  if (rawNodes.length > MAX_GRAPH_NODES) {
    fail(`${path}.nodes`, `must contain at most ${MAX_GRAPH_NODES} nodes`);
  }
  if (rawEdges.length > MAX_GRAPH_EDGES) {
    fail(`${path}.edges`, `must contain at most ${MAX_GRAPH_EDGES} edges`);
  }

  const explicitFormulaTypes = new Set<string>();
  const nodes = rawNodes.map((rawNode, index): AuthoredNodeData => {
    const nodePath = `${path}.nodes[${index}]`;
    const node = readRecord(rawNode, nodePath);
    if (typeof node.kind !== 'string' || !NODE_KINDS.has(node.kind)) {
      fail(`${nodePath}.kind`, 'is not a supported node kind');
    }
    const common = commonNodeFields(node, nodePath);
    switch (node.kind) {
      case 'income':
      case 'expense': {
        const baseValue = readFiniteNumber(node.baseValue, `${nodePath}.baseValue`, legacy ? 0 : undefined);
        if (node.kind === 'expense' && baseValue < 0) {
          fail(`${nodePath}.baseValue`, 'expenses must be non-negative monthly-flow magnitudes');
        }
        const timeUnit = TIME_UNITS.has(node.timeUnit as TimeUnit)
          ? (node.timeUnit as TimeUnit)
          : legacy
            ? 'per_month'
            : fail(`${nodePath}.timeUnit`, 'must be a supported time unit');
        return { ...common, kind: node.kind, baseValue, timeUnit };
      }
      case 'value':
        return {
          ...common,
          kind: 'value',
          baseValue: readFiniteNumber(node.baseValue, `${nodePath}.baseValue`, legacy ? 0 : undefined),
        };
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide': {
        const fallback = node.kind === 'multiply' || node.kind === 'divide' ? 1 : 0;
        return {
          ...common,
          kind: node.kind,
          leftValue: readFiniteNumber(node.leftValue, `${nodePath}.leftValue`, legacy ? fallback : undefined),
          rightValue: readFiniteNumber(node.rightValue, `${nodePath}.rightValue`, legacy ? fallback : undefined),
        };
      }
      case 'calc': {
        const outputType =
          node.outputType === 'scalar' || node.outputType === 'monthly-flow'
            ? node.outputType
            : legacy
              ? 'scalar'
              : fail(`${nodePath}.outputType`, 'must be scalar or monthly-flow');
        if (node.outputType === 'scalar' || node.outputType === 'monthly-flow') {
          explicitFormulaTypes.add(common.id);
        }
        const formula = typeof node.formula === 'string' ? node.formula : legacy ? '' : fail(`${nodePath}.formula`, 'must be a string');
        if (formula.length > MAX_FORMULA_LENGTH) {
          fail(`${nodePath}.formula`, `must be at most ${MAX_FORMULA_LENGTH} characters`);
        }
        return { ...common, kind: 'calc', formula, outputType };
      }
      case 'asset':
        return {
          ...common,
          kind: 'asset',
          initialBalance: readNonNegativeNumber(
            node.initialBalance,
            `${nodePath}.initialBalance`,
            legacy ? 0 : undefined,
          ),
          interestRateAnnual: readFiniteNumber(
            node.interestRateAnnual,
            `${nodePath}.interestRateAnnual`,
            legacy ? 0 : undefined,
          ),
        };
      case 'output':
        return {
          ...common,
          kind: 'output',
          targetAmount: readNonNegativeNumber(node.targetAmount, `${nodePath}.targetAmount`, legacy ? 0 : undefined),
        };
      case 'custom': {
        const customPath = `${nodePath}.custom`;
        const custom = readRecord(node.custom, customPath);
        const internalGraph = migrateGraph(custom.internalGraph, `${customPath}.internalGraph`, depth + 1, legacy);
        const inputs = migratePorts(custom.inputs, `${customPath}.inputs`, legacy, false) as AuthoredInputPortDef[];
        const outputs = migratePorts(custom.outputs, `${customPath}.outputs`, legacy, true) as AuthoredOutputPortDef[];
        const inputBindings = readRecord(custom.inputBindings, `${customPath}.inputBindings`);
        const outputBindings = readRecord(custom.outputBindings, `${customPath}.outputBindings`);
        const migratedConfig: AuthoredCustomNodeConfig = {
          inputs,
          outputs,
          internalGraph,
          inputBindings: Object.fromEntries(
            inputs.map((port) => [
              port.id,
              readString(inputBindings[port.id], `${customPath}.inputBindings.${port.id}`, 128),
            ]),
          ),
          outputBindings: Object.fromEntries(
            outputs.map((port) => [
              port.id,
              readString(outputBindings[port.id], `${customPath}.outputBindings.${port.id}`, 128),
            ]),
          ),
        };
        if (legacy) {
          migratedConfig.inputs.forEach((port) => {
            const boundId = migratedConfig.inputBindings[port.id];
            const boundType = getRuntimeNodeOutputType(internalGraph, boundId);
            if (boundType === 'scalar' || boundType === 'monthly-flow' || boundType === 'timeseries') {
              port.valueType = boundType;
            }
          });
          migratedConfig.outputs.forEach((port) => {
            const boundId = migratedConfig.outputBindings[port.id];
            const boundType = getRuntimeNodeOutputType(internalGraph, boundId);
            if (boundType === 'scalar' || boundType === 'monthly-flow' || boundType === 'timeseries') {
              port.valueType = boundType;
            }
          });
        }
        return { ...common, kind: 'custom', custom: migratedConfig };
      }
      case 'text':
        return { ...common, kind: 'text' };
      default:
        return fail(`${nodePath}.kind`, 'is not supported');
    }
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const seenNodeIds = new Set<string>();
  nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      fail(`${path}.nodes[${index}].id`, `duplicate node id ${node.id}`);
    }
    seenNodeIds.add(node.id);
  });

  const seenEdgeIds = new Set<string>();
  const binaryInputCounts = new Map<string, number>();
  const edges = rawEdges.map((rawEdge, index): AuthoredEdgeData => {
    const edgePath = `${path}.edges[${index}]`;
    const edge = readRecord(rawEdge, edgePath);
    const id = readString(edge.id, `${edgePath}.id`, 128);
    if (seenEdgeIds.has(id)) {
      fail(`${edgePath}.id`, `duplicate edge id ${id}`);
    }
    seenEdgeIds.add(id);
    if (edge.kind !== 'flow') {
      fail(`${edgePath}.kind`, 'must be flow');
    }
    const source = readString(edge.source, `${edgePath}.source`, 128);
    const target = readString(edge.target, `${edgePath}.target`, 128);
    const sourceNode = nodeMap.get(source) ?? fail(`${edgePath}.source`, `unknown node ${source}`);
    const targetNode = nodeMap.get(target) ?? fail(`${edgePath}.target`, `unknown node ${target}`);
    let sourcePort = typeof edge.sourcePort === 'string' ? edge.sourcePort : undefined;
    let targetPort = typeof edge.targetPort === 'string' ? edge.targetPort : undefined;

    if (sourceNode.kind === 'custom') {
      if (!sourcePort && legacy) {
        sourcePort = sourceNode.custom.outputs[0]?.id;
      }
      if (!sourcePort || !sourceNode.custom.outputs.some((port) => port.id === sourcePort)) {
        fail(`${edgePath}.sourcePort`, 'must select an existing custom output port');
      }
    } else if (sourceNode.kind === 'asset') {
      if (!sourcePort && legacy) {
        sourcePort = targetNode.kind === 'output' ? 'balance' : 'endingBalance';
      }
      if (sourcePort !== 'balance' && sourcePort !== 'endingBalance') {
        fail(`${edgePath}.sourcePort`, 'asset edges must select balance or endingBalance');
      }
    } else if (sourcePort !== undefined) {
      fail(`${edgePath}.sourcePort`, 'source node has no named output ports');
    }

    if (targetNode.kind === 'custom') {
      if (!targetPort && legacy) {
        targetPort = targetNode.custom.inputs[0]?.id;
      }
      if (!targetPort || !targetNode.custom.inputs.some((port) => port.id === targetPort)) {
        fail(`${edgePath}.targetPort`, 'must select an existing custom input port');
      }
    } else if (
      targetNode.kind === 'add' ||
      targetNode.kind === 'subtract' ||
      targetNode.kind === 'multiply' ||
      targetNode.kind === 'divide'
    ) {
      if (targetPort === 'left') {
        targetPort = '1';
      } else if (targetPort === 'right') {
        targetPort = '2';
      }
      if (!targetPort && legacy) {
        const count = binaryInputCounts.get(target) ?? 0;
        targetPort = count === 0 ? '1' : '2';
        binaryInputCounts.set(target, count + 1);
      }
      if (targetPort !== '1' && targetPort !== '2') {
        fail(`${edgePath}.targetPort`, 'binary edges must select input 1 or 2');
      }
    } else if (targetPort !== undefined) {
      fail(`${edgePath}.targetPort`, 'target node has no named input ports');
    }

    return {
      id,
      source,
      target,
      kind: 'flow',
      ...(sourcePort === undefined ? {} : { sourcePort }),
      ...(targetPort === undefined ? {} : { targetPort }),
      weight: readNonNegativeNumber(edge.weight, `${edgePath}.weight`, legacy ? 1 : undefined),
      lagMonths: readInteger(edge.lagMonths, `${edgePath}.lagMonths`, 0, MAX_HORIZON_MONTHS, legacy ? 0 : undefined),
    };
  });

  const authoredGraph: AuthoredGraphData = {
    nodes,
    edges,
    ...(graph.nodeScale === undefined
      ? {}
      : { nodeScale: readFiniteNumber(graph.nodeScale, `${path}.nodeScale`) }),
  };
  if (legacy) {
    migrateLegacyFormulaReferences(authoredGraph);
  }
  inferLegacyFormulaTypes(authoredGraph, explicitFormulaTypes);
  validateCustomBindings(authoredGraph, path);
  return authoredGraph;
};

const validateCustomBindings = (graph: AuthoredGraphData, path: string) => {
  graph.nodes.forEach((node, nodeIndex) => {
    if (node.kind !== 'custom') {
      return;
    }
    const customPath = `${path}.nodes[${nodeIndex}].custom`;
    const internalNodes = new Map(node.custom.internalGraph.nodes.map((internal) => [internal.id, internal]));
    node.custom.inputs.forEach((port, portIndex) => {
      const boundId = node.custom.inputBindings[port.id];
      const boundNode =
        internalNodes.get(boundId) ??
        fail(`${customPath}.inputBindings.${port.id}`, `unknown internal node ${boundId}`);
      if (boundNode.kind !== 'income' && boundNode.kind !== 'value') {
        fail(`${customPath}.inputBindings.${port.id}`, 'must target an income or value node');
      }
      const boundType = getRuntimeNodeOutputType(node.custom.internalGraph, boundId);
      if (boundType !== port.valueType) {
        fail(
          `${customPath}.inputs[${portIndex}].valueType`,
          `does not match bound ${boundType ?? 'unknown'} node ${boundId}`,
        );
      }
    });
    node.custom.outputs.forEach((port, portIndex) => {
      const boundId = node.custom.outputBindings[port.id];
      const boundNode =
        internalNodes.get(boundId) ??
        fail(`${customPath}.outputBindings.${port.id}`, `unknown internal node ${boundId}`);
      let boundType = getRuntimeNodeOutputType(node.custom.internalGraph, boundId);
      if (boundNode.kind === 'asset' && port.valueType === 'timeseries') {
        boundType = 'timeseries';
      }
      if (boundNode.kind === 'custom' && boundNode.custom.outputs.length > 1) {
        const matches = boundNode.custom.outputs.filter((output) => output.valueType === port.valueType);
        boundType = matches.length === 1 ? matches[0].valueType : undefined;
      }
      if (boundType !== port.valueType) {
        fail(
          `${customPath}.outputs[${portIndex}].valueType`,
          `does not match bound ${boundType ?? 'unknown'} node ${boundId}`,
        );
      }
    });
  });
};

const readSimulationSettings = (value: unknown, path: string, legacy: boolean): SimulationSettingsV1 => {
  if (legacy && value === undefined) {
    return { ...DEFAULT_SIMULATION_SETTINGS };
  }
  const settings = readRecord(value, path);
  if (settings.version !== 1) {
    fail(`${path}.version`, 'must be 1');
  }
  if (settings.contributionTiming !== 'end-of-month') {
    fail(`${path}.contributionTiming`, 'must be end-of-month');
  }
  if (settings.annualRateConvention !== 'nominal-divided-by-12') {
    fail(`${path}.annualRateConvention`, 'must be nominal-divided-by-12');
  }
  if (settings.monthZero !== 'initial-balance') {
    fail(`${path}.monthZero`, 'must be initial-balance');
  }
  return {
    version: 1,
    horizonMonths: readInteger(settings.horizonMonths, `${path}.horizonMonths`, 1, MAX_HORIZON_MONTHS),
    contributionTiming: 'end-of-month',
    annualRateConvention: 'nominal-divided-by-12',
    monthZero: 'initial-balance',
  };
};

export const migrateGraphDocument = (value: unknown): GraphDocument => {
  const root = readRecord(value, '$');
  if (root.schemaVersion !== undefined && root.schemaVersion !== GRAPH_DOCUMENT_SCHEMA_VERSION) {
    fail('$.schemaVersion', `unsupported schema version ${String(root.schemaVersion)}`);
  }
  const legacy = root.schemaVersion === undefined;
  const graphSource = legacy ? root : root.graph;
  const settingsSource = legacy ? undefined : readRecord(root.settings, '$.settings').simulation;
  return {
    schemaVersion: GRAPH_DOCUMENT_SCHEMA_VERSION,
    settings: {
      simulation: readSimulationSettings(settingsSource, '$.settings.simulation', legacy),
    },
    graph: migrateGraph(graphSource, '$.graph', 0, legacy),
  };
};

export const createGraphDocument = (
  graph: GraphData,
  simulation: SimulationSettingsV1 = DEFAULT_SIMULATION_SETTINGS,
): GraphDocument =>
  migrateGraphDocument({
    schemaVersion: GRAPH_DOCUMENT_SCHEMA_VERSION,
    settings: { simulation },
    graph: migrateGraph(graph, '$.graph', 0, true),
  });

export const parseGraphDocumentText = (text: string): GraphDocument => {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_IMPORT_BYTES) {
    fail('$', `document exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const cause = error instanceof Error ? error.message : 'invalid JSON';
    fail('$', `invalid JSON: ${cause}`);
  }
  return migrateGraphDocument(parsed);
};

export const serializeGraphDocument = (document: GraphDocument) =>
  `${JSON.stringify(migrateGraphDocument(document), null, 2)}\n`;

export const graphDocumentToRuntimeGraph = (document: GraphDocument): GraphData => ({
  nodes: document.graph.nodes.map((node) => structuredClone(node) as EconNodeData),
  edges: document.graph.edges.map((edge) => ({ ...edge } as EconEdgeData)),
  ...(document.graph.nodeScale === undefined ? {} : { nodeScale: document.graph.nodeScale }),
});

export const mergeCustomGraphIntoRoot = (
  rootGraph: GraphData,
  customNodeId: string,
  internalGraph: GraphData,
): GraphData => ({
  ...rootGraph,
  nodes: rootGraph.nodes.map((node) =>
    node.id === customNodeId && node.kind === 'custom' && node.custom
      ? {
          ...node,
          custom: {
            ...node.custom,
            internalGraph,
          },
        }
      : node,
  ),
});
