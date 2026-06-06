import { useEffect, useMemo, useState } from 'react';
import type { EconNodeData, GraphData, NodeKind } from '../models/types';

type GraphScope = 'main' | string;

export type HierarchyItem = {
  id: string;
  label: string;
  kind: NodeKind;
  graphScope: GraphScope;
  children?: HierarchyItem[];
};

type HierarchyPanelProps = {
  graph: GraphData;
  selectedNodeId?: string;
  activeCustomNodeId?: string;
  onSelectNode: (nodeId: string) => void;
  onSelectInternalNode: (customNodeId: string, nodeId: string) => void;
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

const buildItem = (node: EconNodeData, graphScope: GraphScope): HierarchyItem => ({
  id: node.id,
  label: node.label || node.id,
  kind: node.kind,
  graphScope,
  children:
    node.kind === 'custom' && node.custom
      ? node.custom.internalGraph.nodes.map((child) => buildItem(child, node.id))
      : undefined,
});

const collectCustomIds = (items: HierarchyItem[]) =>
  items.flatMap((item) => (item.kind === 'custom' ? [item.id] : []));

export const HierarchyPanel = ({
  graph,
  selectedNodeId,
  activeCustomNodeId,
  onSelectNode,
  onSelectInternalNode,
}: HierarchyPanelProps) => {
  const items = useMemo(() => graph.nodes.map((node) => buildItem(node, 'main')), [graph]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(collectCustomIds(items)));

  useEffect(() => {
    const customIds = collectCustomIds(items);
    if (customIds.length === 0) {
      return;
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      customIds.forEach((id) => next.add(id));
      return next;
    });
  }, [items]);

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const renderItem = (item: HierarchyItem, depth: number) => {
    const hasChildren = Boolean(item.children?.length);
    const isExpanded = expandedIds.has(item.id);
    const isSelected =
      item.id === selectedNodeId && (item.graphScope === 'main' || item.graphScope === activeCustomNodeId);
    const isActiveCustom = item.id === activeCustomNodeId;
    const buttonLabel =
      item.graphScope === 'main'
        ? `Select ${item.label}`
        : `Open ${item.label} inside ${item.graphScope}`;

    return (
      <div key={`${item.graphScope}-${item.id}`} className="hierarchy-node">
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
              onClick={() => toggleExpanded(item.id)}
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
            onClick={() => {
              if (item.graphScope === 'main') {
                onSelectNode(item.id);
                return;
              }
              onSelectInternalNode(item.graphScope, item.id);
            }}
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
        <h2>Hierarchy</h2>
        {activeCustomNodeId && <div className="hierarchy-active">Inside {activeCustomNodeId}</div>}
      </div>
      <div className="hierarchy-root">Main Graph</div>
      <div className="hierarchy-tree">{items.map((item) => renderItem(item, 0))}</div>
    </aside>
  );
};
