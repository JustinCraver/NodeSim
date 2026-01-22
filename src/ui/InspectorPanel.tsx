import type React from 'react';
import type { EconEdgeData, EconNodeData, TimeUnit } from '../models/types';

const TIME_UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'per_day', label: 'Per Day' },
  { value: 'per_week', label: 'Per Week' },
  { value: 'per_month', label: 'Per Month' },
  { value: 'per_year', label: 'Per Year' },
];

type InspectorPanelProps = {
  node: EconNodeData | null;
  edge: EconEdgeData | null;
  onChange: (nodeId: string, data: Partial<EconNodeData>) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
};

export const InspectorPanel = ({ node, edge, onChange, onDeleteNode, onDeleteEdge }: InspectorPanelProps) => {
  if (!node && !edge) {
    return (
      <div className="panel">
        <h2>Inspector</h2>
        <p>Select a node or connection to edit its properties.</p>
      </div>
    );
  }

  if (!node && edge) {
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

  const handleNumberChange = (field: keyof EconNodeData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    onChange(node.id, { [field]: Number.isNaN(value) ? undefined : value } as Partial<EconNodeData>);
  };

  const handleTextChange = (field: keyof EconNodeData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(node.id, { [field]: event.target.value } as Partial<EconNodeData>);
  };

  const handleTimeUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(node.id, { timeUnit: event.target.value as TimeUnit });
  };

  return (
    <div className="panel">
      <h2>Inspector</h2>
      <div className="panel-section">
        <div className="label">Label</div>
        <div>{node.label}</div>
      </div>
      <div className="panel-section">
        <div className="label">Type</div>
        <div>{node.kind}</div>
      </div>
      {(node.kind === 'income' || node.kind === 'expense') && (
        <>
          <label className="panel-section">
            <span className="label">Base Value</span>
            <input type="number" value={node.baseValue ?? ''} onChange={handleNumberChange('baseValue')} />
          </label>
          <label className="panel-section">
            <span className="label">Time Unit</span>
            <select value={node.timeUnit ?? 'per_month'} onChange={handleTimeUnitChange}>
              {TIME_UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {node.kind === 'calc' && (
        <label className="panel-section">
          <span className="label">Formula</span>
          <input type="text" value={node.formula ?? ''} onChange={handleTextChange('formula')} />
        </label>
      )}
      {node.kind === 'asset' && (
        <label className="panel-section">
          <span className="label">Interest Rate (Annual)</span>
          <input
            type="number"
            step="0.001"
            value={node.interestRateAnnual ?? ''}
            onChange={handleNumberChange('interestRateAnnual')}
          />
        </label>
      )}
      {node.kind === 'output' && (
        <label className="panel-section">
          <span className="label">Target Amount</span>
          <input type="number" value={node.targetAmount ?? ''} onChange={handleNumberChange('targetAmount')} />
        </label>
      )}
      <div className="panel-section">
        <div className="label">Computed</div>
        <div>{node.computedValue ?? '--'}</div>
      </div>
      <div className="panel-section">
        <button
          className="delete-button"
          onClick={() => onDeleteNode(node.id)}
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
