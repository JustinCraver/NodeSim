import { useMemo, useState, type KeyboardEvent } from 'react';
import {
  appendGraphPath,
  formatGraphPath,
  graphPathsEqual,
  graphPathKey,
  scopedNodeKey,
  type GraphPath,
  type ScopedNodeIdentity,
} from '../graph/graphScope';
import type { ComputeDiagnostic, EconEdgeData, EconNodeData, GraphData, NodeKind } from '../models/types';

type HierarchyPanelProps = {
  graph: GraphData;
  selectedIdentity?: ScopedNodeIdentity;
  selectedEdgeId?: string;
  activeGraphPath: GraphPath;
  diagnostics: readonly ComputeDiagnostic[];
  isFocusEnabled: boolean;
  onToggleFocus: () => void;
  onSelectNode: (identity: ScopedNodeIdentity) => void;
  onSelectEdge: (graphPath: GraphPath, edgeId: string) => void;
};

const KIND_LABELS: Record<NodeKind, string> = {
  income: 'Income',
  expense: 'Expense',
  value: 'Value',
  add: 'Add',
  subtract: 'Subtract',
  multiply: 'Multiply',
  divide: 'Divide',
  calc: 'Formula',
  asset: 'Asset',
  output: 'Output',
  custom: 'Custom graph',
  text: 'Text',
};

const nodeValue = (node: EconNodeData) => {
  if (node.outputState?.kind === 'unreachable') {
    return 'unreachable';
  }
  if (node.outputState?.kind === 'month') {
    return `month ${node.outputState.month}`;
  }
  if (Number.isFinite(node.computedValue)) {
    return String(node.computedValue);
  }
  if (Number.isFinite(node.baseValue)) {
    return String(node.baseValue);
  }
  if (node.formula !== undefined) {
    return node.formula.trim() ? `formula ${node.formula}` : 'empty formula';
  }
  if (Number.isFinite(node.initialBalance)) {
    return `initial balance ${node.initialBalance}`;
  }
  if (Number.isFinite(node.targetAmount)) {
    return `target ${node.targetAmount}`;
  }
  if (Number.isFinite(node.leftValue) || Number.isFinite(node.rightValue)) {
    return `inputs ${node.leftValue ?? 0} and ${node.rightValue ?? 0}`;
  }
  return node.kind === 'text' ? node.label : 'no value';
};

const nodePorts = (node: EconNodeData) => {
  if (node.kind === 'custom' && node.custom) {
    return [
      ...node.custom.inputs.map((port) => `input ${port.label}, ${port.valueType ?? 'scalar'}`),
      ...node.custom.outputs.map((port) => `output ${port.label}, ${port.valueType ?? 'scalar'}`),
    ];
  }
  if (node.kind === 'asset') {
    return ['output Balance series, timeseries', 'output Ending balance, scalar'];
  }
  if (node.kind === 'add' || node.kind === 'subtract' || node.kind === 'multiply' || node.kind === 'divide') {
    return ['input 1, scalar', 'input 2, scalar', 'output Result, scalar'];
  }
  return node.kind === 'text' ? [] : ['output Value'];
};

const diagnosticsFor = (
  diagnostics: readonly ComputeDiagnostic[],
  path: GraphPath,
  match: (diagnostic: ComputeDiagnostic) => boolean,
) => diagnostics.filter((diagnostic) => diagnostic.graphPath === formatGraphPath(path) && match(diagnostic));

export const HierarchyPanel = ({
  graph,
  selectedIdentity,
  selectedEdgeId,
  activeGraphPath,
  diagnostics,
  isFocusEnabled,
  onToggleFocus,
  onSelectNode,
  onSelectEdge,
}: HierarchyPanelProps) => {
  const initialExpanded = useMemo(() => {
    const keys = new Set<string>();
    const visit = (current: GraphData, path: GraphPath) => {
      current.nodes.forEach((node) => {
        if (node.kind === 'custom' && node.custom) {
          const identity = Object.freeze({ graphPath: path, nodeId: node.id });
          keys.add(scopedNodeKey(identity));
          visit(node.custom.internalGraph, appendGraphPath(path, node.id));
        }
      });
    };
    visit(graph, Object.freeze([]));
    return keys;
  }, [graph]);
  const [expandedKeys, setExpandedKeys] = useState(initialExpanded);

  const toggleExpanded = (identity: ScopedNodeIdentity) => {
    const key = scopedNodeKey(identity);
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).getAttribute('role') === 'treeitem') {
      event.preventDefault();
      (event.target as HTMLElement).click();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'));
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, current + 1);
    if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  const renderEdge = (edge: EconEdgeData, path: GraphPath, depth: number, nodeLabels: Map<string, string>) => {
    const errors = diagnosticsFor(diagnostics, path, (diagnostic) => diagnostic.edgeId === edge.id);
    const source = nodeLabels.get(edge.source) ?? edge.source;
    const target = nodeLabels.get(edge.target) ?? edge.target;
    const portText = [edge.sourcePort ? `source port ${edge.sourcePort}` : '', edge.targetPort ? `target port ${edge.targetPort}` : '']
      .filter(Boolean)
      .join(', ');
    return (
      <button
        key={`${graphPathKey(path)}:${edge.id}`}
        type="button"
        role="treeitem"
        aria-selected={selectedEdgeId === edge.id && graphPathsEqual(activeGraphPath, path)}
        className="semantic-tree-item semantic-edge-item"
        style={{ paddingLeft: `${18 + depth * 18}px` }}
        onClick={() => onSelectEdge(path, edge.id)}
      >
        <span className="semantic-item-title">Connection: {source} to {target}</span>
        <span className="semantic-item-detail">Weight {edge.weight ?? 1}, lag {edge.lagMonths ?? 0} months{portText ? `, ${portText}` : ''}</span>
        {errors.map((error) => <span key={error.message} className="semantic-item-error">Error: {error.message}</span>)}
      </button>
    );
  };

  const renderGraph = (current: GraphData, path: GraphPath, depth: number): JSX.Element => {
    const nodeLabels = new Map(current.nodes.map((node) => [node.id, node.label || node.id]));
    return (
      <div role="group" aria-label={`${formatGraphPath(path)} contents`}>
        {current.nodes.map((node) => {
          const identity = Object.freeze({ graphPath: path, nodeId: node.id });
          const key = scopedNodeKey(identity);
          const expanded = expandedKeys.has(key);
          const errors = diagnosticsFor(diagnostics, path, (diagnostic) => diagnostic.nodeId === node.id);
          const selected = selectedIdentity?.nodeId === node.id && graphPathsEqual(selectedIdentity.graphPath, path);
          return (
            <div key={key} className="semantic-node-branch">
              <div className="semantic-node-row" style={{ paddingLeft: `${depth * 18}px` }}>
                {node.kind === 'custom' && node.custom ? (
                  <button type="button" className="hierarchy-disclosure" aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`} aria-expanded={expanded} onClick={() => toggleExpanded(identity)}>
                    <span aria-hidden="true">{expanded ? '-' : '+'}</span>
                  </button>
                ) : <span className="hierarchy-disclosure-placeholder" />}
                <button type="button" role="treeitem" aria-selected={selected} className="semantic-tree-item" onClick={() => onSelectNode(identity)}>
                  <span className="semantic-item-title">{node.label || node.id}</span>
                  <span className="semantic-item-detail">{KIND_LABELS[node.kind]}, value {nodeValue(node)}</span>
                  {nodePorts(node).map((port) => <span key={port} className="semantic-item-detail">Port: {port}</span>)}
                  {errors.map((error) => <span key={error.message} className="semantic-item-error">Error: {error.message}</span>)}
                </button>
              </div>
              {node.kind === 'custom' && node.custom && expanded && renderGraph(node.custom.internalGraph, appendGraphPath(path, node.id), depth + 1)}
            </div>
          );
        })}
        {current.edges.length > 0 && (
          <div className="semantic-edge-group" role="group" aria-label={`Connections in ${formatGraphPath(path)}`}>
            <div className="semantic-group-label" style={{ paddingLeft: `${18 + depth * 18}px` }}>Connections</div>
            {current.edges.map((edge) => renderEdge(edge, path, depth, nodeLabels))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="hierarchy-panel" aria-label="Semantic graph structure">
      <div className="hierarchy-header">
        <div className="hierarchy-title-row">
          <h2>Graph structure</h2>
          <button type="button" className="hierarchy-focus-toggle" aria-pressed={isFocusEnabled} onClick={onToggleFocus}>
            Focus canvas
          </button>
        </div>
        <p>Nodes, ports, values, connections, and errors. Use Tab or Up and Down arrows to move.</p>
        {activeGraphPath.length > 0 && <div className="hierarchy-active">Editing {formatGraphPath(activeGraphPath)}</div>}
      </div>
      <div className="semantic-tree" role="tree" aria-label="Graph nodes and connections" onKeyDown={handleTreeKeyDown}>
        <div className="semantic-root-label">Main graph</div>
        {renderGraph(graph, Object.freeze([]), 0)}
      </div>
    </aside>
  );
};
