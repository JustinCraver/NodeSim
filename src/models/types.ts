export type NodeKind = 'income' | 'expense' | 'calc' | 'asset' | 'output' | 'custom';
export type TimeUnit = 'per_day' | 'per_week' | 'per_month' | 'per_year';

export type PortDef = {
  id: string;
  label: string;
};

export type CustomNodeConfig = {
  inputs: PortDef[];
  outputs: PortDef[];
  internalGraph: GraphData;
  inputBindings: Record<string, string>;
  outputBindings: Record<string, string>;
};

export interface EconNodeData {
  id: string;
  label: string;
  kind: NodeKind;
  position?: { x: number; y: number };
  baseValue?: number;
  timeUnit?: TimeUnit;
  formula?: string;
  interestRateAnnual?: number;
  targetAmount?: number;
  custom?: CustomNodeConfig;
  computedValue?: number;
  timeseries?: number[];
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
}

export interface GraphComputeResult {
  nodes: EconNodeData[];
  errors: Record<string, string>;
}
