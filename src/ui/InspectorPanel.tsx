import { useEffect, useState } from 'react';
import type React from 'react';
import type { CustomNodeConfig, EconEdgeData, EconNodeData, PortDef, TimeUnit } from '../models/types';

const TIME_UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_week', label: 'Per Week' },
  { value: 'per_month', label: 'Per Month' },
  { value: 'per_year', label: 'Per Year' },
];

const BINARY_PORT_OPTIONS: PortDef[] = [
  { id: '1', label: '1' },
  { id: '2', label: '2' },
];

type InspectorPanelProps = {
  node: EconNodeData | null;
  edge: EconEdgeData | null;
  onChange: (nodeId: string, data: Partial<EconNodeData>) => void;
  onChangeEdge: (edgeId: string, data: Partial<EconEdgeData>) => void;
  getNodeById: (nodeId: string) => EconNodeData | null;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
};

export const InspectorPanel = ({
  node,
  edge,
  onChange,
  onChangeEdge,
  getNodeById,
  onDeleteNode,
  onDeleteEdge,
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
  }, [node?.id, node?.kind]);

  if (!node && !edge) {
    return (
      <div className="panel">
        <h2>Inspector</h2>
        <p>Select a node or connection to edit its properties.</p>
      </div>
    );
  }

  if (!node && edge) {
    const sourceNode = getNodeById(edge.source);
    const targetNode = getNodeById(edge.target);
    const sourceOutputs = sourceNode?.kind === 'custom' ? sourceNode.custom?.outputs ?? [] : [];
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
        {sourceNode?.kind === 'custom' && (
          <label className="panel-section">
            <span className="label">Source Port</span>
            <select
              value={edge.sourcePort ?? ''}
              onChange={(event) =>
                onChangeEdge(edge.id, { sourcePort: event.target.value === '' ? undefined : event.target.value })
              }
            >
              <option value="">Default</option>
              {sourceOutputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.label} ({port.id})
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
              <option value="">Default</option>
              {targetPortOptions.map((port) => (
                <option key={port.id} value={port.id}>
                  {port.label} ({port.id})
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="panel-section">
          <button
            className="delete-button"
            onClick={() => onDeleteEdge(edge.id)}
            style={{
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%',
              marginTop: '16px',
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

  const handleNumberChange = (field: keyof EconNodeData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    onChange(activeNode.id, { [field]: Number.isNaN(value) ? undefined : value } as Partial<EconNodeData>);
  };

  const handleTextChange = (field: keyof EconNodeData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(activeNode.id, { [field]: event.target.value } as Partial<EconNodeData>);
  };

  const handleTimeUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(activeNode.id, { timeUnit: event.target.value as TimeUnit });
  };

  const handleCustomUpdate = (config: CustomNodeConfig) => {
    onChange(activeNode.id, { custom: config });
  };

  const createPortId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const addPort = (type: 'input' | 'output') => {
    if (!activeNode.custom) {
      return;
    }
    const id = createPortId(type);
    const newPort: PortDef = { id, label: type === 'input' ? 'Input' : 'Output' };
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
      const parsed = JSON.parse(internalGraphText);
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        setInternalGraphError('Internal graph JSON must include nodes and edges arrays.');
        return;
      }
      handleCustomUpdate({ ...activeNode.custom, internalGraph: parsed });
      setInternalGraphText(JSON.stringify(parsed, null, 2));
      setInternalGraphError(null);
    } catch (error) {
      setInternalGraphError('Invalid JSON.');
    }
  };

  return (
    <div className="panel">
      <h2>Inspector</h2>
      <div className="panel-section">
        <div className="label">Label</div>
        <div>{activeNode.label}</div>
      </div>
      <div className="panel-section">
        <div className="label">Type</div>
        <div>{activeNode.kind}</div>
      </div>
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
        <label className="panel-section">
          <span className="label">Formula</span>
          <input type="text" value={activeNode.formula ?? ''} onChange={handleTextChange('formula')} />
        </label>
      )}
      {activeNode.kind === 'asset' && (
        <label className="panel-section">
          <span className="label">Interest Rate (Annual)</span>
          <input
            type="number"
            step="0.001"
            value={activeNode.interestRateAnnual ?? ''}
            onChange={handleNumberChange('interestRateAnnual')}
          />
        </label>
      )}
      {activeNode.kind === 'output' && (
        <label className="panel-section">
          <span className="label">Target Amount</span>
          <input type="number" value={activeNode.targetAmount ?? ''} onChange={handleNumberChange('targetAmount')} />
        </label>
      )}
      {activeNode.kind === 'custom' && customConfig && (
        <>
          <div className="panel-section">
            <div className="label">Inputs</div>
            {customConfig.inputs.map((port) => (
              <div
                key={port.id}
                style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}
              >
                <input
                  type="text"
                  value={port.label}
                  onChange={(event) => updatePortLabel('input', port.id, event.target.value)}
                />
                <span style={{ fontSize: '11px', color: '#64748b' }}>{port.id}</span>
                <button type="button" onClick={() => removePort('input', port.id)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" style={{ marginTop: '8px' }} onClick={() => addPort('input')}>
              Add Input
            </button>
          </div>
          <div className="panel-section">
            <div className="label">Outputs</div>
            {customConfig.outputs.map((port) => (
              <div
                key={port.id}
                style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}
              >
                <input
                  type="text"
                  value={port.label}
                  onChange={(event) => updatePortLabel('output', port.id, event.target.value)}
                />
                <span style={{ fontSize: '11px', color: '#64748b' }}>{port.id}</span>
                <button type="button" onClick={() => removePort('output', port.id)}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" style={{ marginTop: '8px' }} onClick={() => addPort('output')}>
              Add Output
            </button>
          </div>
          <div className="panel-section">
            <div className="label">Input Bindings</div>
            {customConfig.inputs.map((port) => (
              <label key={port.id} className="panel-section" style={{ marginTop: '8px' }}>
                <span className="label">
                  {port.label} ({port.id})
                </span>
                <select
                  value={customConfig.inputBindings[port.id] ?? ''}
                  onChange={(event) => updateBinding('input', port.id, event.target.value)}
                >
                  <option value="">Unbound</option>
                  {customConfig.internalGraph.nodes.map((internal) => (
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
              <label key={port.id} className="panel-section" style={{ marginTop: '8px' }}>
                <span className="label">
                  {port.label} ({port.id})
                </span>
                <select
                  value={customConfig.outputBindings[port.id] ?? ''}
                  onChange={(event) => updateBinding('output', port.id, event.target.value)}
                >
                  <option value="">Unbound</option>
                  {customConfig.internalGraph.nodes.map((internal) => (
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
              style={{ width: '100%', marginTop: '8px' }}
            />
            {internalGraphError && <div style={{ color: '#dc2626', marginTop: '8px' }}>{internalGraphError}</div>}
            <button type="button" style={{ marginTop: '8px' }} onClick={handleApplyInternalGraph}>
              Apply Internal Graph
            </button>
          </div>
        </>
      )}
      <div className="panel-section">
        <div className="label">Computed</div>
        <div>{activeNode.computedValue ?? '--'}</div>
      </div>
      <div className="panel-section">
        <button
          className="delete-button"
          onClick={() => onDeleteNode(activeNode.id)}
          style={{
            backgroundColor: '#dc2626',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '4px',
            cursor: 'pointer',
            width: '100%',
            marginTop: '16px',
          }}
        >
          Delete Node
        </button>
      </div>
    </div>
  );
};
