import cytoscape, { type Core } from 'cytoscape';
import type { EconEdgeData, EconNodeData, GraphComputeResult, GraphData, NodeKind } from '../models/types';
import { computeGraph } from '../engine/computeGraph';

type GraphCallbacks = {
  onSelectNode?: (node: EconNodeData | null) => void;
  onSelectEdge?: (edge: EconEdgeData | null) => void;
  onOpenCustomNode?: (node: EconNodeData) => void;
};

const BASIC_NODE_OPTIONS: { kind: NodeKind; label: string }[] = [
  { kind: 'value', label: 'Value' },
  { kind: 'add', label: 'Add' },
  { kind: 'subtract', label: 'Subtract' },
  { kind: 'multiply', label: 'Multiply' },
  { kind: 'divide', label: 'Divide' },
];

const ECON_NODE_OPTIONS: { kind: NodeKind; label: string }[] = [
  { kind: 'income', label: 'Income' },
  { kind: 'expense', label: 'Expense' },
  { kind: 'calc', label: 'Calc' },
  { kind: 'asset', label: 'Asset' },
  { kind: 'output', label: 'Output' },
  { kind: 'custom', label: 'Custom' },
];

const formatCurrency = (value: number) => {
  if (Number.isNaN(value)) {
    return '--';
  }
  return `$${value.toFixed(0)}`;
};

const formatMonthlyLabel = (value?: number) => {
  if (value === undefined) {
    return '--';
  }
  return `${formatCurrency(value)} / mo`;
};

const formatOutputValue = (value?: number) => {
  if (value === undefined) {
    return '--';
  }
  if (value < 0) {
    return 'Unreachable';
  }
  return `${value}`;
};

const formatNumberLabel = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) {
    return '--';
  }
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}`;
};

const formatNodeLabel = (node: EconNodeData, error?: string) => {
  let suffix = '';
  switch (node.kind) {
    case 'income':
    case 'expense':
    case 'calc':
    case 'custom':
      suffix = formatMonthlyLabel(node.computedValue);
      break;
    case 'value':
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
      suffix = formatNumberLabel(node.computedValue);
      break;
    case 'asset':
      suffix = formatCurrency(node.computedValue ?? 0);
      break;
    case 'output':
      suffix = formatOutputValue(node.computedValue);
      break;
    default:
      break;
  }

  const base = `${node.label}\n${suffix}`;
  if (error) {
    return `${base}\n⚠ ${error}`;
  }
  return base;
};

const graphDataFromCy = (cy: Core): GraphData => ({
  nodes: cy.nodes().map((node) => {
    const { displayLabel, ...data } = node.data() as EconNodeData & { displayLabel?: string };
    return { ...data, position: node.position() };
  }),
  edges: cy.edges().map((edge) => {
    const data = edge.data() as EconEdgeData;
    return { ...data };
  }),
});

const hasValidPosition = (position?: { x: number; y: number }) =>
  Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y));

const hasMeaningfulPositions = (nodes: EconNodeData[]) => {
  if (nodes.length === 0) {
    return false;
  }
  if (!nodes.every((node) => hasValidPosition(node.position))) {
    return false;
  }
  if (nodes.length === 1) {
    return true;
  }
  const first = nodes[0].position!;
  return nodes.some((node) => {
    const position = node.position!;
    return Math.abs(position.x - first.x) > 0.01 || Math.abs(position.y - first.y) > 0.01;
  });
};

const toCyNodeElement = (node: EconNodeData) =>
  hasValidPosition(node.position) ? { data: node, position: node.position } : { data: node };

const applyComputeResults = (cy: Core, result: GraphComputeResult) => {
  result.nodes.forEach((node) => {
    const element = cy.getElementById(node.id);
    if (element) {
      const error = result.errors[node.id];
      element.data({
        ...node,
        displayLabel: formatNodeLabel(node, error),
      });
    }
  });
};

const recompute = (cy: Core) => {
  const graphData = graphDataFromCy(cy);
  const result = computeGraph(graphData.nodes, graphData.edges);
  applyComputeResults(cy, result);
};

export const createCytoscape = (container: HTMLDivElement, graphData: GraphData, callbacks: GraphCallbacks = {}) => {
  container.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  const hasInitialPositions = hasMeaningfulPositions(graphData.nodes);

  const cy = cytoscape({
    container,
    elements: {
      nodes: graphData.nodes.map((node) => toCyNodeElement(node)),
      edges: graphData.edges.map((edge) => ({ data: edge })),
    },
    style: [
      {
        selector: 'node',
        style: {
          'background-color': '#2563eb',
          label: 'data(displayLabel)',
          color: '#0f172a',
          'text-valign': 'center',
          'text-halign': 'center',
          'text-wrap': 'wrap',
          'text-max-width': '120px',
          'font-size': '10px',
          'border-width': 2,
          'border-color': '#1e3a8a',
          width: 120,
          height: 60,
          'shape': 'roundrectangle',
        },
      },
      {
        selector: 'node:selected',
        style: {
          'border-width': 4,
          'border-color': '#0ea5e9',
          'background-color': '#1d4ed8',
          color: '#e2e8f0',
        },
      },
      {
        selector: 'node.hovered',
        style: {
          'border-width': 3,
          'border-color': '#38bdf8',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'line-color': '#94a3b8',
          'target-arrow-color': '#94a3b8',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'edge:selected',
        style: {
          width: 3,
          'line-color': '#0ea5e9',
          'target-arrow-color': '#0ea5e9',
        },
      },
      {
        selector: 'node[kind = "expense"]',
        style: {
          'background-color': '#f97316',
          'border-color': '#c2410c',
        },
      },
      {
        selector: 'node[kind = "calc"]',
        style: {
          'background-color': '#22c55e',
          'border-color': '#15803d',
        },
      },
      {
        selector: 'node[kind = "asset"]',
        style: {
          'background-color': '#eab308',
          'border-color': '#a16207',
        },
      },
      {
        selector: 'node[kind = "output"]',
        style: {
          'background-color': '#f472b6',
          'border-color': '#be185d',
        },
      },
      {
        selector: 'node[kind = "custom"]',
        style: {
          'background-color': '#a855f7',
          'border-color': '#7e22ce',
        },
      },
      {
        selector: 'node[kind = "value"]',
        style: {
          'background-color': '#64748b',
          'border-color': '#475569',
        },
      },
      {
        selector: 'node[kind = "add"]',
        style: {
          'background-color': '#14b8a6',
          'border-color': '#0f766e',
        },
      },
      {
        selector: 'node[kind = "subtract"]',
        style: {
          'background-color': '#ef4444',
          'border-color': '#b91c1c',
        },
      },
      {
        selector: 'node[kind = "multiply"]',
        style: {
          'background-color': '#22d3ee',
          'border-color': '#0891b2',
        },
      },
      {
        selector: 'node[kind = "divide"]',
        style: {
          'background-color': '#f59e0b',
          'border-color': '#b45309',
        },
      },
    ],
    layout: hasInitialPositions
      ? { name: 'preset' }
      : {
          name: 'breadthfirst',
          directed: true,
          spacingFactor: 1.4,
        },
  });

  recompute(cy);

  cy.on('select', 'node', (event) => {
    cy.edges(':selected').unselect();
    const node = event.target.data() as EconNodeData;
    callbacks.onSelectNode?.({ ...node });
  });

  cy.on('unselect', 'node', () => {
    callbacks.onSelectNode?.(null);
  });

  cy.on('dbltap', 'node', (event) => {
    const node = event.target.data() as EconNodeData;
    if (node.kind !== 'custom' || !node.custom) {
      return;
    }
    callbacks.onOpenCustomNode?.({ ...node });
  });

  cy.on('mouseover', 'node', (event) => {
    event.target.addClass('hovered');
  });

  cy.on('mouseout', 'node', (event) => {
    event.target.removeClass('hovered');
  });

  cy.on('select', 'edge', (event) => {
    cy.nodes(':selected').unselect();
    const edge = event.target.data() as EconEdgeData;
    callbacks.onSelectEdge?.({ ...edge });
  });

  cy.on('unselect', 'edge', () => {
    callbacks.onSelectEdge?.(null);
  });

  let nodeSequence = 1;
  let pendingCreatePosition: { x: number; y: number } | null = null;
  let contextMenu: HTMLDivElement | null = null;

  const createNodeAt = (position: { x: number; y: number }, kind: NodeKind) => {
    const id = `node-${Date.now()}-${nodeSequence}`;
    const label = `Node ${cy.nodes().length + 1}`;
    nodeSequence += 1;
    const node: EconNodeData = {
      id,
      label,
      kind,
    };
    if (kind === 'income' || kind === 'expense') {
      node.baseValue = 0;
      node.timeUnit = 'per_month';
    }
    if (kind === 'value') {
      node.baseValue = 0;
    }
    if (kind === 'custom') {
      const inputPortId = 'in-1';
      const outputPortId = 'out-1';
      const internalInputId = 'internal-input';
      const internalCalcId = 'internal-output';
      node.custom = {
        inputs: [{ id: inputPortId, label: 'Input' }],
        outputs: [{ id: outputPortId, label: 'Output' }],
        internalGraph: {
          nodes: [
            {
              id: internalInputId,
              label: 'Input',
              kind: 'income',
              baseValue: 0,
              timeUnit: 'per_month',
            },
            {
              id: internalCalcId,
              label: 'Output',
              kind: 'calc',
              formula: internalInputId,
            },
          ],
          edges: [
            {
              id: `edge-${internalInputId}-${internalCalcId}`,
              source: internalInputId,
              target: internalCalcId,
              kind: 'flow',
            },
          ],
        },
        inputBindings: {
          [inputPortId]: internalInputId,
        },
        outputBindings: {
          [outputPortId]: internalCalcId,
        },
      };
    }
    cy.add({
      group: 'nodes',
      data: node,
      position,
    });
    recompute(cy);
    cy.getElementById(id)?.select();
  };

  const hideContextMenu = () => {
    if (!contextMenu) {
      return;
    }
    contextMenu.style.display = 'none';
    pendingCreatePosition = null;
  };

  const showContextMenu = (renderedPosition: { x: number; y: number }, position: { x: number; y: number }) => {
    if (!contextMenu) {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.display = 'none';
      menu.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      const addSection = (title: string, options: { kind: NodeKind; label: string }[]) => {
        const heading = document.createElement('div');
        heading.className = 'context-menu-section';
        heading.textContent = title;
        menu.appendChild(heading);
        options.forEach((option) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = option.label;
          button.addEventListener('click', () => {
            if (!pendingCreatePosition) {
              return;
            }
            createNodeAt(pendingCreatePosition, option.kind);
            hideContextMenu();
          });
          menu.appendChild(button);
        });
      };

      addSection('Basic Math', BASIC_NODE_OPTIONS);
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      menu.appendChild(divider);
      addSection('Economy', ECON_NODE_OPTIONS);
      container.appendChild(menu);
      contextMenu = menu;
    }

    pendingCreatePosition = position;
    contextMenu.style.display = 'flex';
    contextMenu.style.left = `${renderedPosition.x}px`;
    contextMenu.style.top = `${renderedPosition.y}px`;

    const maxX = container.clientWidth - contextMenu.offsetWidth - 8;
    const maxY = container.clientHeight - contextMenu.offsetHeight - 8;
    const clampedX = Math.max(8, Math.min(renderedPosition.x, maxX));
    const clampedY = Math.max(8, Math.min(renderedPosition.y, maxY));
    contextMenu.style.left = `${clampedX}px`;
    contextMenu.style.top = `${clampedY}px`;
  };

  cy.on('cxttap', (event) => {
    if (event.target !== cy) {
      return;
    }
    showContextMenu(event.renderedPosition, event.position);
  });

  cy.on('cxttap', 'node', (event) => {
    hideContextMenu();
    const targetNode = event.target;
    const selectedNode = cy.nodes(':selected').first();
    if (!selectedNode || selectedNode.empty()) {
      return;
    }
    if (selectedNode.id() === targetNode.id()) {
      return;
    }
    const edgeId = `edge-${selectedNode.id()}-${targetNode.id()}-${Date.now()}`;
    cy.add({
      group: 'edges',
      data: {
        id: edgeId,
        source: selectedNode.id(),
        target: targetNode.id(),
        kind: 'flow',
      },
    });
    recompute(cy);
  });

  cy.on('remove add', 'edge', () => {
    recompute(cy);
  });

  const handleGlobalPointerDown = (event: PointerEvent) => {
    if (!contextMenu || contextMenu.style.display === 'none') {
      return;
    }
    const target = event.target as Node | null;
    if (target && contextMenu.contains(target)) {
      return;
    }
    hideContextMenu();
  };

  document.addEventListener('pointerdown', handleGlobalPointerDown, true);
  container.addEventListener('scroll', hideContextMenu);

  const updateNodeData = (nodeId: string, data: Partial<EconNodeData>) => {
    const node = cy.getElementById(nodeId);
    if (!node) {
      return;
    }
    const current = node.data() as EconNodeData;
    node.data({
      ...current,
      ...data,
    });
    recompute(cy);
  };

  const updateEdgeData = (edgeId: string, data: Partial<EconEdgeData>) => {
    const edge = cy.getElementById(edgeId);
    if (!edge) {
      return;
    }
    const current = edge.data() as EconEdgeData;
    edge.data({
      ...current,
      ...data,
    });
    recompute(cy);
  };

  const importGraph = (data: GraphData) => {
    cy.elements().remove();
    cy.add(data.nodes.map((node) => toCyNodeElement(node)));
    cy.add(data.edges.map((edge) => ({ data: edge })));
    recompute(cy);
    const hasPositions = hasMeaningfulPositions(data.nodes);
    if (hasPositions) {
      cy.layout({ name: 'preset' }).run();
    } else {
      cy.layout({ name: 'breadthfirst', directed: true, spacingFactor: 1.4 }).run();
    }
    if (data.nodes.length > 0) {
      cy.fit(undefined, 40);
    }
  };

  const deleteNode = (nodeId: string) => {
    const node = cy.getElementById(nodeId);
    if (!node) {
      return;
    }
    // Unselect the specific node if it's selected
    if (node.selected()) {
      node.unselect();
    }
    // Remove all edges connected to this node
    const connectedEdges = cy.edges(`[source = "${nodeId}"], [target = "${nodeId}"]`);
    connectedEdges.remove();
    // Remove the node itself
    node.remove();
    // Recompute after a brief delay to ensure DOM updates are complete
    setTimeout(() => recompute(cy), 0);
  };

  const deleteEdge = (edgeId: string) => {
    const edge = cy.getElementById(edgeId);
    if (!edge) {
      return;
    }
    if (edge.selected()) {
      edge.unselect();
    }
    edge.remove();
    setTimeout(() => recompute(cy), 0);
  };

  const exportGraph = (): GraphData => graphDataFromCy(cy);

  return {
    cy,
    updateNodeData,
    updateEdgeData,
    deleteNode,
    deleteEdge,
    importGraph,
    exportGraph,
  };
};
