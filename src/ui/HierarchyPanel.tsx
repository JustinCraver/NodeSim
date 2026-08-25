import { useEffect, useMemo, useState } from 'react';
import {
  appendGraphPath,
  formatGraphPath,
  graphPathsEqual,
  ROOT_GRAPH_PATH,
  scopedNodeKey,
  type GraphPath,
  type ScopedNodeIdentity,
} from '../graph/graphScope';
import type { EconNodeData, GraphData, NodeKind } from '../models/types';

export type HierarchyItem = {
  identity: ScopedNodeIdentity;
  label: string;
  kind: NodeKind;
  children?: HierarchyItem[];
};

type HierarchyPanelProps = {
  graph: GraphData;
  selectedIdentity?: ScopedNodeIdentity;
  activeGraphPath: GraphPath;
  isFocusEnabled: boolean;
  onToggleFocus: () => void;
  onSelectNode: (identity: ScopedNodeIdentity) => void;
};

const KIND_LABELS: Record<NodeKind, string> = {
  income: 'Income',
  expense: 'Expense',
  value: 'Value',
  add: 'Add',
  subtract: 'Subtract',
  multiply: 'Multiply',
  divide: 'Divide',
  calc: 'Calc',
  asset: 'Asset',
  output: 'Output',
  custom: 'Custom',
  text: 'Text',
};

const buildItem = (node: EconNodeData, graphPath: GraphPath): HierarchyItem => ({
  identity: Object.freeze({ graphPath, nodeId: node.id }),
  label: node.label || node.id,
  kind: node.kind,
  children:
    node.kind === 'custom' && node.custom
      ? node.custom.internalGraph.nodes.map((child) => buildItem(child, appendGraphPath(graphPath, node.id)))
      : undefined,
});

const collectCustomKeys = (items: HierarchyItem[]): string[] =>
  items.flatMap((item) => [
    ...(item.kind === 'custom' ? [scopedNodeKey(item.identity)] : []),
    ...collectCustomKeys(item.children ?? []),
  ]);

export const HierarchyPanel = ({
  graph,
  selectedIdentity,
  activeGraphPath,
  isFocusEnabled,
  onToggleFocus,
  onSelectNode,
}: HierarchyPanelProps) => {
  const items = useMemo(() => graph.nodes.map((node) => buildItem(node, ROOT_GRAPH_PATH)), [graph]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(collectCustomKeys(items)));

  useEffect(() => {
    const customKeys = collectCustomKeys(items);
    if (customKeys.length === 0) {
      return;
    }
    setExpandedKeys((current) => {
      const next = new Set(current);
      customKeys.forEach((key) => next.add(key));
      return next;
    });
  }, [items]);

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

  const renderItem = (item: HierarchyItem, depth: number) => {
    const hasChildren = Boolean(item.children?.length);
    const itemKey = scopedNodeKey(item.identity);
    const isExpanded = expandedKeys.has(itemKey);
    const isSelected =
      selectedIdentity?.nodeId === item.identity.nodeId &&
      graphPathsEqual(selectedIdentity.graphPath, item.identity.graphPath);
    const childPath = appendGraphPath(item.identity.graphPath, item.identity.nodeId);
    const isActiveCustom = item.kind === 'custom' && graphPathsEqual(childPath, activeGraphPath);
    const buttonLabel = `Select ${item.label} in ${formatGraphPath(item.identity.graphPath)}`;

    return (
      <div key={itemKey} className="hierarchy-node">
        <div
          className={[
            'hierarchy-row',
            isSelected ? 'is-selected' : '',
            isActiveCustom ? 'is-active-custom' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="hierarchy-disclosure"
              aria-label={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
              aria-expanded={isExpanded}
              onClick={() => toggleExpanded(item.identity)}
            >
              {isExpanded ? 'v' : '>'}
            </button>
          ) : (
            <span className="hierarchy-disclosure-placeholder" />
          )}
          <button
            type="button"
            className="hierarchy-item-button"
            title={buttonLabel}
            onClick={() => onSelectNode(item.identity)}
          >
            <span className="hierarchy-item-label">{item.label}</span>
            <span className="hierarchy-kind">{KIND_LABELS[item.kind]}</span>
          </button>
        </div>
        {hasChildren && isExpanded && item.children?.map((child) => renderItem(child, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="hierarchy-panel" aria-label="Graph hierarchy">
      <div className="hierarchy-header">
        <div className="hierarchy-title-row">
          <h2>Hierarchy</h2>
          <button
            type="button"
            className="hierarchy-focus-toggle"
            aria-pressed={isFocusEnabled}
            title={isFocusEnabled ? 'Disable graph focusing' : 'Enable graph focusing'}
            onClick={onToggleFocus}
          >
            Focus
          </button>
        </div>
        {activeGraphPath.length > 0 && (
          <div className="hierarchy-active">Inside {formatGraphPath(activeGraphPath)}</div>
        )}
      </div>
      <div className="hierarchy-root">Main Graph</div>
      <div className="hierarchy-tree">{items.map((item) => renderItem(item, 0))}</div>
    </aside>
  );
};
