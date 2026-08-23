export type NodeKind =
  | 'income'
  | 'expense'
  | 'value'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'calc'
  | 'asset'
  | 'output'
  | 'custom'
  | 'text';

export type TimeUnit = 'per_day' | 'per_week' | 'per_month' | 'per_year';
export type ValueType = 'scalar' | 'monthly-flow' | 'timeseries' | 'none';
export type FormulaValueType = Extract<ValueType, 'scalar' | 'monthly-flow'>;

export type SimulationSettingsV1 = {
  version: 1;
  horizonMonths: number;
  contributionTiming: 'end-of-month';
  annualRateConvention: 'nominal-divided-by-12';
  monthZero: 'initial-balance';
};

export type GraphDocumentSettings = {
  simulation: SimulationSettingsV1;
};

export type PortDef = {
  id: string;
  label: string;
  valueType?: ValueType;
  formulaId?: string;
};

export type CustomNodeConfig = {
  inputs: PortDef[];
  outputs: PortDef[];
  internalGraph: GraphData;
  inputBindings: Record<string, string>;
  outputBindings: Record<string, string>;
};

/**
 * Cytoscape's mutable runtime view. Persisted documents use the discriminated
 * AuthoredNodeData union below; derived fields exist only on this runtime view.
 */
export interface EconNodeData {
  id: string;
  label: string;
  kind: NodeKind;
  position?: { x: number; y: number };
  nodeWidth?: number;
  nodeHeight?: number;
  textMaxWidth?: number;
  baseValue?: number;
  timeUnit?: TimeUnit;
  formula?: string;
  outputType?: FormulaValueType;
  leftValue?: number;
  rightValue?: number;
  input1Value?: number;
  input2Value?: number;
  input1Connected?: boolean;
  input2Connected?: boolean;
  portOverlay?: string;
  initialBalance?: number;
  interestRateAnnual?: number;
  targetAmount?: number;
  custom?: CustomNodeConfig;
  computedValue?: number;
  timeseries?: number[];
  outputState?: OutputState;
  valueType?: ValueType;
}

export interface EconEdgeData {
  id: string;
  source: string;
  target: string;
  kind: 'flow';
  sourcePort?: string;
  targetPort?: string;
  weight?: number;
  lagMonths?: number;
}

export interface GraphData {
  nodes: EconNodeData[];
  edges: EconEdgeData[];
  nodeScale?: number;
}

type AuthoredNodeBase<K extends NodeKind> = {
  id: string;
  label: string;
  kind: K;
  position?: { x: number; y: number };
};

export type AuthoredFlowNodeData = AuthoredNodeBase<'income' | 'expense'> & {
  baseValue: number;
  timeUnit: TimeUnit;
};

export type AuthoredValueNodeData = AuthoredNodeBase<'value'> & {
  baseValue: number;
};

export type AuthoredBinaryNodeData = AuthoredNodeBase<'add' | 'subtract' | 'multiply' | 'divide'> & {
  leftValue: number;
  rightValue: number;
};

export type AuthoredFormulaNodeData = AuthoredNodeBase<'calc'> & {
  formula: string;
  outputType: FormulaValueType;
};

export type AuthoredAssetNodeData = AuthoredNodeBase<'asset'> & {
  initialBalance: number;
  interestRateAnnual: number;
};

export type AuthoredOutputNodeData = AuthoredNodeBase<'output'> & {
  targetAmount: number;
};

export type AuthoredInputPortDef = {
  id: string;
  label: string;
  valueType: Exclude<ValueType, 'none'>;
};

export type AuthoredOutputPortDef = AuthoredInputPortDef & {
  formulaId: string;
};

export type AuthoredCustomNodeConfig = {
  inputs: AuthoredInputPortDef[];
  outputs: AuthoredOutputPortDef[];
  internalGraph: AuthoredGraphData;
  inputBindings: Record<string, string>;
  outputBindings: Record<string, string>;
};

export type AuthoredCustomNodeData = AuthoredNodeBase<'custom'> & {
  custom: AuthoredCustomNodeConfig;
};

export type AuthoredTextNodeData = AuthoredNodeBase<'text'>;

export type AuthoredNodeData =
  | AuthoredFlowNodeData
  | AuthoredValueNodeData
  | AuthoredBinaryNodeData
  | AuthoredFormulaNodeData
  | AuthoredAssetNodeData
  | AuthoredOutputNodeData
  | AuthoredCustomNodeData
  | AuthoredTextNodeData;

export type AuthoredEdgeData = {
  id: string;
  source: string;
  target: string;
  kind: 'flow';
  sourcePort?: string;
  targetPort?: string;
  weight: number;
  lagMonths: number;
};

export type AuthoredGraphData = {
  nodes: AuthoredNodeData[];
  edges: AuthoredEdgeData[];
  nodeScale?: number;
};

export type GraphDocument = {
  schemaVersion: 1;
  settings: GraphDocumentSettings;
  graph: AuthoredGraphData;
};

export type NumericRuntimeValue =
  | { type: 'scalar'; value: number }
  | { type: 'monthly-flow'; samples: number[] }
  | { type: 'timeseries'; samples: number[] };

export type RuntimeValue = NumericRuntimeValue | { type: 'none' };

export type OutputState = { kind: 'month'; month: number } | { kind: 'unreachable' };

export type ComputeDiagnosticCode =
  | 'blocked_dependency'
  | 'cycle_member'
  | 'division_by_zero'
  | 'duplicate_id'
  | 'formula_error'
  | 'invalid_edge'
  | 'invalid_number'
  | 'invalid_port'
  | 'invalid_type'
  | 'missing_value'
  | 'simulation_error';

export type ComputeDiagnostic = {
  code: ComputeDiagnosticCode;
  nodeId?: string;
  edgeId?: string;
  graphPath: string;
  message: string;
  cause?: string;
};

export interface GraphComputeResult {
  nodes: EconNodeData[];
  errors: Record<string, string>;
  diagnostics: ComputeDiagnostic[];
  nodeValues: Map<string, RuntimeValue>;
  outputTypes: Map<string, Map<string, ValueType>>;
  customOutputs: Map<string, Map<string, RuntimeValue>>;
}
