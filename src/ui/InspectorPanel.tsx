import { useEffect, useState } from 'react';
import type React from 'react';
import {
  graphDocumentToRuntimeGraph,
  MAX_HORIZON_MONTHS,
  migrateGraphDocument,
} from '../document/graphDocument';
import {
  diagnoseCustomBindings,
  getCompatibleInputBindingNodes,
  getCompatibleOutputBindingNodes,
  repairCustomBindings,
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
  ValueType,
} from '../models/types';

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

const COMPUTATIONAL_VALUE_TYPES: Exclude<ValueType, 'none'>[] = ['scalar', 'monthly-flow', 'timeseries'];

type InspectorPanelProps = {
  node: EconNodeData | null;
  edge: EconEdgeData | null;
  onChange: (nodeId: string, data: Partial<EconNodeData>) => void;
  onChangeEdge: (edgeId: string, data: Partial<EconEdgeData>) => void;
  getNodeById: (nodeId: string) => EconNodeData | null;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  graphPath: string;
  diagnostics: readonly ComputeDiagnostic[];
  selectionKey?: string;
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
            {diagnostic.nodeId ? ` · node ${diagnostic.nodeId}` : ''}
            {diagnostic.edgeId ? ` · edge ${diagnostic.edgeId}` : ''}
            {diagnostic.portId ? ` · port ${diagnostic.portId}` : ''}
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
  onChangeEdge,
  getNodeById,
  onDeleteNode,
  onDeleteEdge,
  graphPath,
  diagnostics,
  selectionKey,
}: InspectorPanelProps) => {
  const [internalGraphText, setInternalGraphText] = useState('');
  const [internalGraphError, setInternalGraphError] = useState<string | null>(null);

  useEffect(() => {
    if (node?.kind !== 'custom') {
      return;
    }
    const graph = node.custom?.internalGraph ?? { nodes: [], edges: [] };
    setInternalGraphText(JSON.stringify(graph, null, 2));
    setInternalGraphError(null);
  }, [node?.id, node?.kind, selectionKey]);

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
            {edge.source} → {edge.target}
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
        <label className="panel-section">
          <span className="label">Weight</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={edge.weight ?? 1}
            onChange={(event) => onChangeEdge(edge.id, { weight: Number(event.target.value) })}
          />
        </label>
        <label className="panel-section">
          <span className="label">Lag (months)</span>
          <input
            type="number"
            min="0"
            max={MAX_HORIZON_MONTHS}
            step="1"
            value={edge.lagMonths ?? 0}
            onChange={(event) => onChangeEdge(edge.id, { lagMonths: Number(event.target.value) })}
          />
        </label>
        <div className="panel-section">
          <button
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
            Delete Connection
          </button>
        </div>
      </div>
    );
  }

  if (!node) {
    return null;
  }
  const activeNode = node;
  const customConfig = activeNode.custom;
  const bindingDiagnostics =
    activeNode.kind === 'custom' && customConfig
      ? diagnoseCustomBindings(customConfig, graphPath, activeNode.id)
      : [];

  const handleNumberChange = (field: keyof EconNodeData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    onChange(activeNode.id, { [field]: Number.isNaN(value) ? undefined : value } as Partial<EconNodeData>);
  };

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

  const handleCustomUpdate = (config: CustomNodeConfig) => {
    onChange(activeNode.id, { custom: config });
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

  const createPortId = (prefix: string) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  const addPort = (type: 'input' | 'output') => {
    if (!activeNode.custom) {
      return;
    }
    const id = createPortId(type);
    const newPort: PortDef = {
      id,
      label: type === 'input' ? 'Input' : 'Output',
      valueType: 'scalar',
      ...(type === 'output' ? { formulaId: id } : {}),
    };
    if (type === 'input') {
      handleCustomUpdate({
        ...activeNode.custom,
        inputs: [...activeNode.custom.inputs, newPort],
        inputBindings: { ...activeNode.custom.inputBindings, [id]: '' },
      });
    } else {
      handleCustomUpdate({
        ...activeNode.custom,
        outputs: [...activeNode.custom.outputs, newPort],
        outputBindings: { ...activeNode.custom.outputBindings, [id]: '' },
      });
    }
  };

  const removePort = (type: 'input' | 'output', portId: string) => {
    if (!activeNode.custom) {
      return;
    }
    if (type === 'input') {
      const nextBindings = { ...activeNode.custom.inputBindings };
      delete nextBindings[portId];
      handleCustomUpdate({
        ...activeNode.custom,
        inputs: activeNode.custom.inputs.filter((port) => port.id !== portId),
        inputBindings: nextBindings,
      });
    } else {
      const nextBindings = { ...activeNode.custom.outputBindings };
      delete nextBindings[portId];
      handleCustomUpdate({
        ...activeNode.custom,
        outputs: activeNode.custom.outputs.filter((port) => port.id !== portId),
        outputBindings: nextBindings,
      });
    }
  };

  const updatePortLabel = (type: 'input' | 'output', portId: string, label: string) => {
    if (!activeNode.custom) {
      return;
    }
    if (type === 'input') {
      handleCustomUpdate({
        ...activeNode.custom,
        inputs: activeNode.custom.inputs.map((port) => (port.id === portId ? { ...port, label } : port)),
      });
    } else {
      handleCustomUpdate({
        ...activeNode.custom,
        outputs: activeNode.custom.outputs.map((port) => (port.id === portId ? { ...port, label } : port)),
      });
    }
  };

  const updatePortType = (type: 'input' | 'output', portId: string, valueType: Exclude<ValueType, 'none'>) => {
    if (!activeNode.custom) {
      return;
    }
    const key = type === 'input' ? 'inputs' : 'outputs';
    handleCustomUpdate({
      ...activeNode.custom,
      [key]: activeNode.custom[key].map((port) => (port.id === portId ? { ...port, valueType } : port)),
    });
  };

  const updateOutputFormulaId = (portId: string, formulaId: string) => {
    if (!activeNode.custom) {
      return;
    }
    handleCustomUpdate({
      ...activeNode.custom,
      outputs: activeNode.custom.outputs.map((port) => (port.id === portId ? { ...port, formulaId } : port)),
    });
  };

  const updateBinding = (type: 'input' | 'output', portId: string, value: string) => {
    if (!activeNode.custom) {
      return;
    }
    if (type === 'input') {
      handleCustomUpdate({
        ...activeNode.custom,
        inputBindings: { ...activeNode.custom.inputBindings, [portId]: value },
      });
    } else {
      handleCustomUpdate({
        ...activeNode.custom,
        outputBindings: { ...activeNode.custom.outputBindings, [portId]: value },
      });
    }
  };

  const handleApplyInternalGraph = () => {
    if (!activeNode.custom) {
      return;
    }
    try {
      const parsed = JSON.parse(internalGraphText) as unknown;
      const validated = graphDocumentToRuntimeGraph(migrateGraphDocument(parsed));
      handleCustomUpdate({ ...activeNode.custom, internalGraph: validated });
      setInternalGraphText(JSON.stringify(validated, null, 2));
      setInternalGraphError(null);
    } catch (error) {
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
          <label className="panel-section">
            <span className="label">Base Value</span>
            <input type="number" value={activeNode.baseValue ?? ''} onChange={handleNumberChange('baseValue')} />
          </label>
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
        <label className="panel-section">
          <span className="label">Value</span>
          <input type="number" value={activeNode.baseValue ?? ''} onChange={handleNumberChange('baseValue')} />
        </label>
      )}
      {(activeNode.kind === 'add' ||
        activeNode.kind === 'subtract' ||
        activeNode.kind === 'multiply' ||
        activeNode.kind === 'divide') && (
        <>
          <label className="panel-section">
            <span className="label">Input 1 Value</span>
            <input type="number" value={activeNode.leftValue ?? ''} onChange={handleNumberChange('leftValue')} />
          </label>
          <label className="panel-section">
            <span className="label">Input 2 Value</span>
            <input type="number" value={activeNode.rightValue ?? ''} onChange={handleNumberChange('rightValue')} />
          </label>
        </>
      )}
      {activeNode.kind === 'calc' && (
        <>
          <label className="panel-section">
            <span className="label">Formula</span>
            <input type="text" value={activeNode.formula ?? ''} onChange={handleTextChange('formula')} />
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
          <label className="panel-section">
            <span className="label">Initial balance</span>
            <input
              type="number"
              min="0"
              value={activeNode.initialBalance ?? ''}
              onChange={handleNumberChange('initialBalance')}
            />
          </label>
          <label className="panel-section">
            <span className="label">Nominal annual rate</span>
            <input
              type="number"
              step="0.001"
              value={activeNode.interestRateAnnual ?? ''}
              onChange={handleNumberChange('interestRateAnnual')}
            />
          </label>
        </>
      )}
      {activeNode.kind === 'output' && (
        <label className="panel-section">
          <span className="label">Target Amount</span>
          <input type="number" value={activeNode.targetAmount ?? ''} onChange={handleNumberChange('targetAmount')} />
        </label>
      )}
      {activeNode.kind === 'custom' && customConfig && (
        <>
          {bindingDiagnostics.length > 0 && (
            <div className="panel-section">
              <div className="label">Binding Repair</div>
              <p>Bindings are unchanged. Repair creates typed zero-value placeholders only when you choose it.</p>
              <DiagnosticList diagnostics={bindingDiagnostics} />
              <button
                type="button"
                onClick={() => {
                  const repaired = repairCustomBindings(customConfig, graphPath, activeNode.id);
                  handleCustomUpdate(repaired.custom);
                  setInternalGraphError(
                    repaired.unresolvedDiagnostics.length > 0
                      ? `${repaired.unresolvedDiagnostics.length} binding issue(s) still require manual repair.`
                      : null,
                  );
                }}
              >
                Repair Invalid Bindings
              </button>
            </div>
          )}
          <div className="panel-section">
            <div className="label">Inputs</div>
            {customConfig.inputs.map((port) => (
              <div
                key={port.id}
                style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' }}
              >
                <input
                  type="text"
                  value={port.label}
                  onChange={(event) => updatePortLabel('input', port.id, event.target.value)}
                />
                <select
                  value={port.valueType ?? 'scalar'}
                  onChange={(event) =>
                    updatePortType('input', port.id, event.target.value as Exclude<ValueType, 'none'>)
                  }
                >
                  {COMPUTATIONAL_VALUE_TYPES.map((valueType) => (
                    <option key={valueType} value={valueType}>
                      {valueType}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '16px', color: '#64748b' }}>{port.id}</span>
                <button type="button" onClick={() => removePort('input', port.id)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" style={{ marginTop: '12px' }} onClick={() => addPort('input')}>
              Add Input
            </button>
          </div>
          <div className="panel-section">
            <div className="label">Outputs</div>
            {customConfig.outputs.map((port) => (
              <div
                key={port.id}
                style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '12px' }}
              >
                <input
                  type="text"
                  value={port.label}
                  onChange={(event) => updatePortLabel('output', port.id, event.target.value)}
                />
                <select
                  value={port.valueType ?? 'scalar'}
                  onChange={(event) =>
                    updatePortType('output', port.id, event.target.value as Exclude<ValueType, 'none'>)
                  }
                >
                  {COMPUTATIONAL_VALUE_TYPES.map((valueType) => (
                    <option key={valueType} value={valueType}>
                      {valueType}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`${port.label} formula identity`}
                  value={port.formulaId ?? ''}
                  onChange={(event) => updateOutputFormulaId(port.id, event.target.value)}
                />
                <span style={{ fontSize: '16px', color: '#64748b' }}>{port.id}</span>
                <button type="button" onClick={() => removePort('output', port.id)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" style={{ marginTop: '12px' }} onClick={() => addPort('output')}>
              Add Output
            </button>
          </div>
          <div className="panel-section">
            <div className="label">Input Bindings</div>
            {customConfig.inputs.map((port) => (
              <label key={port.id} className="panel-section" style={{ marginTop: '12px' }}>
                <span className="label">
                  {port.label} ({port.id})
                </span>
                <select
                  value={customConfig.inputBindings[port.id] ?? ''}
                  onChange={(event) => updateBinding('input', port.id, event.target.value)}
                >
                  <option value="">Unbound</option>
                  {getCompatibleInputBindingNodes(customConfig.internalGraph, port.valueType ?? 'scalar')
                    .map((internal) => (
                    <option key={internal.id} value={internal.id}>
                      {internal.label} ({internal.id})
                    </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <div className="panel-section">
            <div className="label">Output Bindings</div>
            {customConfig.outputs.map((port) => (
              <label key={port.id} className="panel-section" style={{ marginTop: '12px' }}>
                <span className="label">
                  {port.label} ({port.id})
                </span>
                <select
                  value={customConfig.outputBindings[port.id] ?? ''}
                  onChange={(event) => updateBinding('output', port.id, event.target.value)}
                >
                  <option value="">Unbound</option>
                  {getCompatibleOutputBindingNodes(customConfig.internalGraph, port.valueType ?? 'scalar')
                    .map((internal) => (
                    <option key={internal.id} value={internal.id}>
                      {internal.label} ({internal.id})
                    </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <div className="panel-section">
            <div className="label">Internal Graph</div>
            <textarea
              rows={8}
              value={internalGraphText}
              onChange={(event) => setInternalGraphText(event.target.value)}
              style={{ width: '100%', marginTop: '12px' }}
            />
            {internalGraphError && <div style={{ color: '#dc2626', marginTop: '12px' }}>{internalGraphError}</div>}
            <button type="button" style={{ marginTop: '12px' }} onClick={handleApplyInternalGraph}>
              Apply Internal Graph
            </button>
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
          Delete Node
        </button>
      </div>
    </div>
  );
};
