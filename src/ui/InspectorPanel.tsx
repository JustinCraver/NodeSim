import { useEffect, useId, useState } from 'react';
import type React from 'react';
import {
  graphDocumentToRuntimeGraph,
  MAX_HORIZON_MONTHS,
  migrateGraphDocument,
} from '../document/graphDocument';
import {
  diagnoseCustomBindings,
  repairCustomBindings,
  type CustomBindingRepairResult,
} from '../graph/customBindings';
import type {
  ComputeDiagnostic,
  CustomNodeConfig,
  EconEdgeData,
  EconNodeData,
  FormulaValueType,
  NodeKind,
  PortDef,
  TimeUnit,
} from '../models/types';
import { NumericDraftField } from './NumericDraftField';
import { CustomPortsEditor } from './CustomPortsEditor';

const TIME_UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_week', label: 'Per Week' },
  { value: 'per_month', label: 'Per Month' },
  { value: 'per_year', label: 'Per Year' },
];

const NODE_KIND_GROUPS: { label: string; options: { value: NodeKind; label: string }[] }[] = [
  {
    label: 'Basic Math',
    options: [
      { value: 'value', label: 'Value' },
      { value: 'add', label: 'Add' },
      { value: 'subtract', label: 'Subtract' },
      { value: 'multiply', label: 'Multiply' },
      { value: 'divide', label: 'Divide' },
    ],
  },
  {
    label: 'Economy',
    options: [
      { value: 'income', label: 'Income' },
      { value: 'expense', label: 'Expense' },
      { value: 'calc', label: 'Calc' },
      { value: 'asset', label: 'Asset' },
      { value: 'output', label: 'Output' },
      { value: 'custom', label: 'Custom' },
    ],
  },
  {
    label: 'Text',
    options: [{ value: 'text', label: 'Text' }],
  },
];

const BINARY_PORT_OPTIONS: PortDef[] = [
  { id: '1', label: '1', valueType: 'scalar' },
  { id: '2', label: '2', valueType: 'scalar' },
];

type InspectorPanelProps = {
  node: EconNodeData | null;
  edge: EconEdgeData | null;
  onChange: (nodeId: string, data: Partial<EconNodeData>) => boolean;
  onChangeCustom: (nodeId: string, custom: CustomNodeConfig, mode: 'ports' | 'repair') => string | undefined;
  onChangeEdge: (edgeId: string, data: Partial<EconEdgeData>) => void;
  getNodeById: (nodeId: string) => EconNodeData | null;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  graphPath: string;
  diagnostics: readonly ComputeDiagnostic[];
  selectionKey?: string;
  documentRevision: number;
};

const DiagnosticList = ({ diagnostics }: { diagnostics: readonly ComputeDiagnostic[] }) => {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <section className="panel-section diagnostic-list" aria-label="Structured diagnostics">
      <div className="label">Diagnostics</div>
      {diagnostics.map((diagnostic, index) => (
        <div
          className="diagnostic-item"
          key={`${diagnostic.graphPath}-${diagnostic.nodeId ?? ''}-${diagnostic.edgeId ?? ''}-${diagnostic.portId ?? ''}-${index}`}
        >
          <div>{diagnostic.message}</div>
          <div className="diagnostic-context">
            path {diagnostic.graphPath}
            {diagnostic.nodeId ? `, node ${diagnostic.nodeId}` : ''}
            {diagnostic.edgeId ? `, connection ${diagnostic.edgeId}` : ''}
            {diagnostic.portId ? `, port ${diagnostic.portId}` : ''}
          </div>
          {diagnostic.cause && <div className="diagnostic-cause">{diagnostic.cause}</div>}
        </div>
      ))}
    </section>
  );
};

export const InspectorPanel = ({
  node,
  edge,
  onChange,
  onChangeCustom,
  onChangeEdge,
  getNodeById,
  onDeleteNode,
  onDeleteEdge,
  graphPath,
  diagnostics,
  selectionKey,
  documentRevision,
}: InspectorPanelProps) => {
  const [internalGraphText, setInternalGraphText] = useState('');
  const [internalGraphError, setInternalGraphError] = useState<string | null>(null);
  const [bindingRepair, setBindingRepair] = useState<CustomBindingRepairResult | null>(null);
  const internalGraphId = useId();
  const internalGraphErrorId = `${internalGraphId}-error`;

  useEffect(() => {
    if (node?.kind !== 'custom') {
      return;
    }
    const graph = node.custom?.internalGraph ?? { nodes: [], edges: [] };
    setInternalGraphText(JSON.stringify(graph, null, 2));
    setInternalGraphError(null);
    setBindingRepair(null);
  }, [node?.id, node?.kind, selectionKey, JSON.stringify(node?.custom)]);

  if (!node && !edge) {
    return (
      <div className="panel">
        <h2>Inspector</h2>
        <DiagnosticList diagnostics={diagnostics} />
        <p>Select a node or connection to edit its properties.</p>
      </div>
    );
  }

  if (!node && edge) {
    const sourceNode = getNodeById(edge.source);
    const targetNode = getNodeById(edge.target);
    const sourceOutputs =
      sourceNode?.kind === 'custom'
        ? sourceNode.custom?.outputs ?? []
        : sourceNode?.kind === 'asset'
          ? [
              { id: 'balance', label: 'Balance series', valueType: 'timeseries' as const },
              { id: 'endingBalance', label: 'Ending balance', valueType: 'scalar' as const },
            ]
          : [];
    const targetInputs = targetNode?.kind === 'custom' ? targetNode.custom?.inputs ?? [] : [];
    const targetMathPorts =
      targetNode?.kind === 'add' ||
      targetNode?.kind === 'subtract' ||
      targetNode?.kind === 'multiply' ||
      targetNode?.kind === 'divide'
        ? BINARY_PORT_OPTIONS
        : [];
    const targetPortOptions = targetNode?.kind === 'custom' ? targetInputs : targetMathPorts;
    const showTargetPorts = targetNode?.kind === 'custom' || targetMathPorts.length > 0;
    const targetPortValue =
      edge.targetPort === 'left'
        ? '1'
        : edge.targetPort === 'right'
          ? '2'
          : edge.targetPort ?? '';

    return (
      <div className="panel">
        <h2>Inspector</h2>
        <DiagnosticList diagnostics={diagnostics} />
        <div className="panel-section">
          <div className="label">Connection</div>
          <div>
            {edge.source} to {edge.target}
          </div>
        </div>
        <div className="panel-section">
          <div className="label">Type</div>
          <div>{edge.kind}</div>
        </div>
        {sourceOutputs.length > 0 && (
          <label className="panel-section">
            <span className="label">Source Port</span>
            <select
              value={edge.sourcePort ?? ''}
              onChange={(event) =>
                onChangeEdge(edge.id, { sourcePort: event.target.value === '' ? undefined : event.target.value })
              }
            >
              <option value="" disabled>
                Select output
              </option>
              {sourceOutputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.label} ({port.id}, {port.valueType ?? 'scalar'})
                </option>
              ))}
            </select>
          </label>
        )}
        {showTargetPorts && (
          <label className="panel-section">
            <span className="label">Target Port</span>
            <select
              value={targetPortValue}
              onChange={(event) =>
                onChangeEdge(edge.id, { targetPort: event.target.value === '' ? undefined : event.target.value })
              }
            >
              <option value="" disabled>
                Select input
              </option>
              {targetPortOptions.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.label} ({port.id})
                </option>
              ))}
            </select>
          </label>
        )}
        <NumericDraftField className="panel-section" label="Weight" min={0} step={0.01} value={edge.weight ?? 1} onCommit={(value) => onChangeEdge(edge.id, { weight: value })} />
        <NumericDraftField className="panel-section" label="Lag (months)" min={0} max={MAX_HORIZON_MONTHS} integer value={edge.lagMonths ?? 0} onCommit={(value) => onChangeEdge(edge.id, { lagMonths: value })} />
        <div className="panel-section">
          <button
            type="button"
            className="delete-button"
            onClick={() => onDeleteEdge(edge.id)}
            style={{
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '6px',
              cursor: 'pointer',
              width: '100%',
              marginTop: '24px',
            }}
          >
            Delete connection (Undo available)
          </button>
          <p className="destructive-help">Removes this connection. Undo restores it.</p>
        </div>
      </div>
    );
  }

  if (!node) {
    return null;
  }
  const activeNode = node;
  const customConfig = activeNode.custom;
  const nodeDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.nodeId === activeNode.id && diagnostic.graphPath === graphPath,
  );
  const formulaError = activeNode.kind === 'calc' ? nodeDiagnostics[0] : undefined;
  const formulaErrorId = `${internalGraphId}-formula-error`;
  const handleTextChange =
    (field: keyof EconNodeData) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(activeNode.id, { [field]: event.target.value } as Partial<EconNodeData>);
    };

  const handleTimeUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(activeNode.id, { timeUnit: event.target.value as TimeUnit });
  };

  const handleFormulaTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(activeNode.id, { outputType: event.target.value as FormulaValueType });
  };

  const createDefaultCustomConfig = (): CustomNodeConfig => {
    const inputPortId = 'in-1';
    const outputPortId = 'out-1';
    const internalInputId = 'internal_input';
    const internalOutputId = 'internal_output';

    return {
      inputs: [{ id: inputPortId, label: 'Input', valueType: 'scalar' }],
      outputs: [{ id: outputPortId, label: 'Output', valueType: 'scalar', formulaId: 'out_1' }],
      internalGraph: {
        nodes: [
          {
            id: internalInputId,
            label: 'Input',
            kind: 'value',
            baseValue: 0,
          },
          {
            id: internalOutputId,
            label: 'Output',
            kind: 'value',
            baseValue: 0,
          },
        ],
        edges: [],
      },
      inputBindings: {
        [inputPortId]: internalInputId,
      },
      outputBindings: {
        [outputPortId]: internalOutputId,
      },
    };
  };

  const buildKindUpdate = (kind: NodeKind): Partial<EconNodeData> => {
    const reset: Partial<EconNodeData> = {
      kind,
      baseValue: undefined,
      timeUnit: undefined,
      leftValue: undefined,
      rightValue: undefined,
      formula: undefined,
      outputType: undefined,
      interestRateAnnual: undefined,
      initialBalance: undefined,
      targetAmount: undefined,
      custom: undefined,
      input1Value: undefined,
      input2Value: undefined,
      input1Connected: undefined,
      input2Connected: undefined,
      timeseries: undefined,
    };

    switch (kind) {
      case 'income':
      case 'expense':
        return { ...reset, baseValue: 0, timeUnit: 'per_month' };
      case 'value':
        return { ...reset, baseValue: 0 };
      case 'add':
      case 'subtract':
        return { ...reset, leftValue: 0, rightValue: 0 };
      case 'multiply':
      case 'divide':
        return { ...reset, leftValue: 1, rightValue: 1 };
      case 'calc':
        return { ...reset, formula: '', outputType: 'scalar' };
      case 'asset':
        return { ...reset, initialBalance: 0, interestRateAnnual: 0 };
      case 'output':
        return { ...reset, targetAmount: 0 };
      case 'text':
        return { ...reset };
      case 'custom':
        return { ...reset, custom: createDefaultCustomConfig() };
      default:
        return reset;
    }
  };

  const handleKindChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextKind = event.target.value as NodeKind;
    if (nextKind === activeNode.kind) {
      return;
    }
    const update = buildKindUpdate(nextKind);
    if (nextKind === 'custom' && activeNode.custom) {
      update.custom = activeNode.custom;
    }
    onChange(activeNode.id, update);
  };

  const handleApplyInternalGraph = () => {
    if (!activeNode.custom) {
      return;
    }
    try {
      const parsed = JSON.parse(internalGraphText) as unknown;
      const validated = graphDocumentToRuntimeGraph(migrateGraphDocument(parsed));
      const candidate = { ...activeNode.custom, internalGraph: validated };
      if (diagnoseCustomBindings(candidate, graphPath, activeNode.id).length > 0) {
        setBindingRepair(repairCustomBindings(candidate, graphPath, activeNode.id));
        setInternalGraphError('This graph draft breaks existing bindings. Review the explicit repair below or correct the draft.');
        return;
      }
      if (!onChange(activeNode.id, { custom: candidate })) {
        setInternalGraphError('The graph could not be applied. Check the document status for the validation error.');
        return;
      }
      setInternalGraphText(JSON.stringify(validated, null, 2));
      setInternalGraphError(null);
      setBindingRepair(null);
    } catch (error) {
      setBindingRepair(null);
      setInternalGraphError(error instanceof Error ? error.message : 'Invalid internal graph JSON.');
    }
  };

  return (
    <div className="panel">
      <h2>Inspector</h2>
      <DiagnosticList diagnostics={diagnostics} />
      {activeNode.kind === 'text' ? (
        <label className="panel-section">
          <span className="label">Text</span>
          <textarea
            rows={6}
            value={activeNode.label}
            onChange={handleTextChange('label')}
            style={{ width: '100%', marginTop: '12px' }}
          />
        </label>
      ) : (
        <label className="panel-section">
          <span className="label">Label</span>
          <input type="text" value={activeNode.label} onChange={handleTextChange('label')} />
        </label>
      )}
      <label className="panel-section">
        <span className="label">Type</span>
        <select value={activeNode.kind} onChange={handleKindChange}>
          {NODE_KIND_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {(activeNode.kind === 'income' || activeNode.kind === 'expense') && (
        <>
          <NumericDraftField className="panel-section" label="Base value" value={activeNode.baseValue ?? 0} onCommit={(value) => onChange(activeNode.id, { baseValue: value })} />
          <label className="panel-section">
            <span className="label">Time Unit</span>
            <select value={activeNode.timeUnit ?? 'per_month'} onChange={handleTimeUnitChange}>
              {TIME_UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {activeNode.kind === 'value' && (
        <NumericDraftField className="panel-section" label="Value" value={activeNode.baseValue ?? 0} onCommit={(value) => onChange(activeNode.id, { baseValue: value })} />
      )}
      {(activeNode.kind === 'add' ||
        activeNode.kind === 'subtract' ||
        activeNode.kind === 'multiply' ||
        activeNode.kind === 'divide') && (
        <>
          <NumericDraftField className="panel-section" label="Input 1 value" value={activeNode.leftValue ?? 0} onCommit={(value) => onChange(activeNode.id, { leftValue: value })} />
          <NumericDraftField className="panel-section" label="Input 2 value" value={activeNode.rightValue ?? 0} onCommit={(value) => onChange(activeNode.id, { rightValue: value })} />
        </>
      )}
      {activeNode.kind === 'calc' && (
        <>
          <label className="panel-section">
            <span className="label">Formula</span>
            <input
              type="text"
              value={activeNode.formula ?? ''}
              aria-invalid={formulaError ? 'true' : undefined}
              aria-describedby={formulaError ? formulaErrorId : undefined}
              onChange={handleTextChange('formula')}
            />
            {formulaError && <span id={formulaErrorId} className="field-error">{formulaError.message}</span>}
          </label>
          <label className="panel-section">
            <span className="label">Formula result type</span>
            <select value={activeNode.outputType ?? 'scalar'} onChange={handleFormulaTypeChange}>
              <option value="scalar">Scalar</option>
              <option value="monthly-flow">Monthly flow</option>
            </select>
          </label>
        </>
      )}
      {activeNode.kind === 'asset' && (
        <>
          <NumericDraftField className="panel-section" label="Initial balance" min={0} value={activeNode.initialBalance ?? 0} onCommit={(value) => onChange(activeNode.id, { initialBalance: value })} />
          <NumericDraftField className="panel-section" label="Nominal annual rate" step={0.001} value={activeNode.interestRateAnnual ?? 0} onCommit={(value) => onChange(activeNode.id, { interestRateAnnual: value })} />
        </>
      )}
      {activeNode.kind === 'output' && (
        <NumericDraftField className="panel-section" label="Target amount" value={activeNode.targetAmount ?? 0} onCommit={(value) => onChange(activeNode.id, { targetAmount: value })} />
      )}
      {activeNode.kind === 'custom' && customConfig && (
        <>
          <CustomPortsEditor
            key={selectionKey ?? activeNode.id}
            custom={customConfig}
            documentRevision={documentRevision}
            onCommit={(custom) => onChangeCustom(activeNode.id, custom, 'ports')}
          />
          <div className="panel-section">
            <label className="label" htmlFor={internalGraphId}>Internal graph</label>
            <textarea
              id={internalGraphId}
              rows={8}
              value={internalGraphText}
              aria-invalid={internalGraphError ? 'true' : undefined}
              aria-describedby={internalGraphError ? internalGraphErrorId : undefined}
              onChange={(event) => { setInternalGraphText(event.target.value); setBindingRepair(null); setInternalGraphError(null); }}
              style={{ width: '100%', marginTop: '12px' }}
            />
            {internalGraphError && <div id={internalGraphErrorId} className="field-error">{internalGraphError}</div>}
            <button type="button" style={{ marginTop: '12px' }} onClick={handleApplyInternalGraph}>
              Apply Internal Graph
            </button>
            {bindingRepair && (
              <section className="custom-port-draft" aria-label="Binding repair preview">
                <p>Repair will add typed zero-value placeholder nodes for these ports: {bindingRepair.repairedPortIds.join(', ') || 'none'}. The current graph stays unchanged until you apply the repair.</p>
                <DiagnosticList diagnostics={bindingRepair.unresolvedDiagnostics} />
                <button type="button" disabled={bindingRepair.unresolvedDiagnostics.length > 0} onClick={() => {
                  const error = onChangeCustom(activeNode.id, bindingRepair.custom, 'repair');
                  if (error) setInternalGraphError(error);
                  else {
                    setInternalGraphText(JSON.stringify(bindingRepair.custom.internalGraph, null, 2));
                    setBindingRepair(null);
                    setInternalGraphError(null);
                  }
                }}>Repair bindings and apply graph</button>
              </section>
            )}
          </div>
        </>
      )}
      <div className="panel-section">
        <div className="label">Computed</div>
        <div>
          {activeNode.outputState?.kind === 'unreachable'
            ? 'Unreachable'
            : activeNode.outputState?.kind === 'month'
              ? activeNode.outputState.month
              : activeNode.computedValue ?? '--'}
        </div>
      </div>
      <div className="panel-section">
        <button
          type="button"
          className="delete-button"
          onClick={() => onDeleteNode(activeNode.id)}
          style={{
            backgroundColor: '#dc2626',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '6px',
            cursor: 'pointer',
            width: '100%',
            marginTop: '24px',
          }}
        >
          Delete node (Undo available)
        </button>
        <p className="destructive-help">Removes this node and its connections. Undo restores them.</p>
      </div>
    </div>
  );
};
