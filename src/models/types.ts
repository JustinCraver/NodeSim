export type NodeKind = 'income' | 'expense' | 'calc' | 'asset' | 'output';
export type TimeUnit = 'per_day' | 'per_week' | 'per_month' | 'per_year';

export interface EconNodeData {
  id: string;
  label: string;
  kind: NodeKind;
  baseValue?: number;
  timeUnit?: TimeUnit;
  formula?: string;
  interestRateAnnual?: number;
  targetAmount?: number;
  computedValue?: number;
  timeseries?: number[];
}

export interface EconEdgeData {
  id: string;
  source: string;
  target: string;
  kind: 'flow';
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
