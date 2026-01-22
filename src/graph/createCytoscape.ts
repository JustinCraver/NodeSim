import cytoscape, { type Core } from 'cytoscape';
import type { EconEdgeData, EconNodeData, GraphComputeResult, GraphData } from '../models/types';
import { computeGraph } from '../engine/computeGraph';

type GraphCallbacks = {
  onSelectNode?: (node: EconNodeData | null) => void;
};

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

const formatNodeLabel = (node: EconNodeData, error?: string) => {
  let suffix = '';
  switch (node.kind) {
    case 'income':
    case 'expense':
    case 'calc':
      suffix = formatMonthlyLabel(node.computedValue);
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
    return { ...data };
  }),
  edges: cy.edges().map((edge) => {
    const data = edge.data() as EconEdgeData;
    return { ...data };
  }),
});

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

  const cy = cytoscape({
    container,
    elements: {
      nodes: graphData.nodes.map((node) => ({ data: node })),
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
    ],
    layout: {
      name: 'breadthfirst',
      directed: true,
      spacingFactor: 1.4,
    },
  });

  recompute(cy);

  cy.on('select', 'node', (event) => {
    const node = event.target.data() as EconNodeData;
    callbacks.onSelectNode?.({ ...node });
  });

  cy.on('unselect', 'node', () => {
    callbacks.onSelectNode?.(null);
  });

  let edgeSource: string | null = null;
  let nodeSequence = 1;

  const createNodeAt = (position: { x: number; y: number }) => {
    const id = `node-${Date.now()}-${nodeSequence}`;
    const label = `Node ${cy.nodes().length + 1}`;
    nodeSequence += 1;
    const node: EconNodeData = {
      id,
      label,
      kind: 'income',
      baseValue: 0,
      timeUnit: 'per_month',
    };
    cy.add({
      group: 'nodes',
      data: node,
      position,
    });
    recompute(cy);
    cy.getElementById(id)?.select();
  };

  cy.on('tap', 'node', (event) => {
    const node = event.target;
    if (!edgeSource) {
      edgeSource = node.id();
      return;
    }
    if (edgeSource === node.id()) {
      edgeSource = null;
      return;
    }
    const edgeId = `edge-${edgeSource}-${node.id()}-${Date.now()}`;
    cy.add({
      group: 'edges',
      data: {
        id: edgeId,
        source: edgeSource,
        target: node.id(),
        kind: 'flow',
      },
    });
    edgeSource = null;
    recompute(cy);
  });

  cy.on('tap', (event) => {
    if (event.target === cy) {
      edgeSource = null;
    }
  });

  cy.on('cxttap', (event) => {
    if (event.target !== cy) {
      return;
    }
    edgeSource = null;
    createNodeAt(event.position);
  });

  cy.on('remove add', 'edge', () => {
    recompute(cy);
  });

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

  const importGraph = (data: GraphData) => {
    cy.elements().remove();
    cy.add(data.nodes.map((node) => ({ data: node })));
    cy.add(data.edges.map((edge) => ({ data: edge })));
    recompute(cy);
    cy.layout({ name: 'breadthfirst', directed: true, spacingFactor: 1.4 }).run();
  };

  const exportGraph = (): GraphData => graphDataFromCy(cy);

  return {
    cy,
    updateNodeData,
    importGraph,
    exportGraph,
  };
};
