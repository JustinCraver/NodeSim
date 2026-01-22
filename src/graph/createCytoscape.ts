import cytoscape, { type Core, type NodeSingular } from 'cytoscape';
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

const BASE_NODE_WIDTH = 270;
const BASE_NODE_HEIGHT = 135;
const BASE_NODE_FONT_SIZE = 23;
const BASE_TEXT_MAX_WIDTH = 270;
const BASE_PORT_OVERLAY_WIDTH = 270;
const BASE_PORT_OVERLAY_HEIGHT = 135;
const BASE_PORT_CIRCLE_RADIUS = 9;
const BASE_PORT_CIRCLE_STROKE = 3;
const BASE_PORT_TEXT_SIZE = 23;
const BASE_PORT_TEXT_Y = 45;
const BASE_PORT_CIRCLE_Y = 14;
const BASE_PORT_LEFT_X = 68;
const BASE_PORT_RIGHT_X = 203;
const BASE_PORT_GLOW_STD = 3;
const BASE_PORT_TARGET_OFFSET = 68;

const scaleValue = (value: number, scale: number) => Math.round(value * scale);

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

const isMathKind = (kind: NodeKind) =>
  kind === 'add' || kind === 'subtract' || kind === 'multiply' || kind === 'divide';

const formatNumberLabel = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) {
    return '--';
  }
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}`;
};

const formatMathInputs = (node: EconNodeData) => {
  const left = node.input1Connected ? node.input1Value : node.leftValue;
  const right = node.input2Connected ? node.input2Value : node.rightValue;
  return {
    left: formatNumberLabel(left),
    right: formatNumberLabel(right),
  };
};

const buildPortOverlay = (node: EconNodeData, scale: number) => {
  const { left, right } = formatMathInputs(node);
  const width = scaleValue(BASE_PORT_OVERLAY_WIDTH, scale);
  const height = scaleValue(BASE_PORT_OVERLAY_HEIGHT, scale);
  const leftX = scaleValue(BASE_PORT_LEFT_X, scale);
  const rightX = scaleValue(BASE_PORT_RIGHT_X, scale);
  const circleY = scaleValue(BASE_PORT_CIRCLE_Y, scale);
  const circleRadius = scaleValue(BASE_PORT_CIRCLE_RADIUS, scale);
  const circleStroke = scaleValue(BASE_PORT_CIRCLE_STROKE, scale);
  const textY = scaleValue(BASE_PORT_TEXT_Y, scale);
  const textSize = scaleValue(BASE_PORT_TEXT_SIZE, scale);
  const glowStd = Math.max(1, scaleValue(BASE_PORT_GLOW_STD, scale));
  const leftFill = node.input1Connected ? '#0ea5e9' : 'none';
  const rightFill = node.input2Connected ? '#0ea5e9' : 'none';
  const leftGlow = node.input1Connected ? 'url(#portGlow)' : 'none';
  const rightGlow = node.input2Connected ? 'url(#portGlow)' : 'none';
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    '<filter id="portGlow" x="-50%" y="-50%" width="200%" height="200%">',
    `<feDropShadow dx="0" dy="0" stdDeviation="${glowStd}" flood-color="#38bdf8" flood-opacity="0.9" />`,
    '</filter>',
    '</defs>',
    `<circle cx="${leftX}" cy="${circleY}" r="${circleRadius}" fill="${leftFill}" stroke="#0f172a" stroke-width="${circleStroke}" filter="${leftGlow}" />`,
    `<circle cx="${rightX}" cy="${circleY}" r="${circleRadius}" fill="${rightFill}" stroke="#0f172a" stroke-width="${circleStroke}" filter="${rightGlow}" />`,
    `<text x="${leftX}" y="${textY}" text-anchor="middle" font-size="${textSize}" fill="#0f172a">${left}</text>`,
    `<text x="${rightX}" y="${textY}" text-anchor="middle" font-size="${textSize}" fill="#0f172a">${right}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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

const graphDataFromCy = (cy: Core, nodeScale: number): GraphData => ({
  nodes: cy.nodes().map((node) => {
    const { displayLabel, portOverlay, ...data } = node.data() as EconNodeData & {
      displayLabel?: string;
      portOverlay?: string;
    };
    return { ...data, position: node.position() };
  }),
  edges: cy.edges().map((edge) => {
    const data = edge.data() as EconEdgeData;
    return { ...data };
  }),
  nodeScale,
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

const applyComputeResults = (cy: Core, result: GraphComputeResult, scale: number) => {
  result.nodes.forEach((node) => {
    const element = cy.getElementById(node.id);
    if (element) {
      const error = result.errors[node.id];
      const portOverlay = isMathKind(node.kind) ? buildPortOverlay(node, scale) : undefined;
      element.data({
        ...node,
        displayLabel: formatNodeLabel(node, error),
        portOverlay,
      });
    }
  });
};

const recompute = (cy: Core, scale: number) => {
  const graphData = graphDataFromCy(cy, scale);
  const result = computeGraph(graphData.nodes, graphData.edges);
  applyComputeResults(cy, result, scale);
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
          'text-max-width': `${BASE_TEXT_MAX_WIDTH}px`,
          'font-size': BASE_NODE_FONT_SIZE,
          'border-width': 2,
          'border-color': '#1e3a8a',
          width: BASE_NODE_WIDTH,
          height: BASE_NODE_HEIGHT,
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
          'z-index': 10,
          'z-compound-depth': 'top',
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
        selector: 'node[kind = "add"], node[kind = "subtract"], node[kind = "multiply"], node[kind = "divide"]',
        style: {
          'background-image': 'data(portOverlay)',
          'background-fit': 'none',
          'background-width': BASE_NODE_WIDTH,
          'background-height': BASE_NODE_HEIGHT,
          'background-position-x': 0,
          'background-position-y': 0,
        },
      },
      {
        selector: 'edge[targetPort = "1"], edge[targetPort = "left"]',
        style: {
          'target-endpoint': `-${BASE_PORT_TARGET_OFFSET} -${BASE_PORT_TARGET_OFFSET}`,
        },
      },
      {
        selector: 'edge[targetPort = "2"], edge[targetPort = "right"]',
        style: {
          'target-endpoint': `${BASE_PORT_TARGET_OFFSET} -${BASE_PORT_TARGET_OFFSET}`,
        },
      },
      {
        selector: 'node[kind = "add"], node[kind = "subtract"], node[kind = "multiply"], node[kind = "divide"]',
        style: {
          'text-valign': 'center',
          'text-margin-y': 0,
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

  let nodeScale = 1;

  const applyNodeScale = (scale: number) => {
    const width = scaleValue(BASE_NODE_WIDTH, scale);
    const height = scaleValue(BASE_NODE_HEIGHT, scale);
    const fontSize = scaleValue(BASE_NODE_FONT_SIZE, scale);
    const textMaxWidth = scaleValue(BASE_TEXT_MAX_WIDTH, scale);
    const offset = scaleValue(BASE_PORT_TARGET_OFFSET, scale);
    cy.style()
      .selector('node')
      .style({
        width,
        height,
        'font-size': fontSize,
        'text-max-width': `${textMaxWidth}px`,
      })
      .selector('node[kind = "add"], node[kind = "subtract"], node[kind = "multiply"], node[kind = "divide"]')
      .style({
        'background-width': width,
        'background-height': height,
      })
      .selector('edge[targetPort = "1"], edge[targetPort = "left"]')
      .style({
        'target-endpoint': `-${offset} -${offset}`,
      })
      .selector('edge[targetPort = "2"], edge[targetPort = "right"]')
      .style({
        'target-endpoint': `${offset} -${offset}`,
      })
      .update();
  };

  const setNodeScale = (scale: number) => {
    nodeScale = Math.max(0.1, scale);
    applyNodeScale(nodeScale);
    recompute(cy, nodeScale);
  };

  recompute(cy, nodeScale);

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
  let edgePortMenu: HTMLDivElement | null = null;
  let pendingEdgeTarget: NodeSingular | null = null;
  let pendingEdgeSource: NodeSingular | null = null;

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
    if (kind === 'add' || kind === 'subtract') {
      node.leftValue = 0;
      node.rightValue = 0;
    }
    if (kind === 'multiply' || kind === 'divide') {
      node.leftValue = 1;
      node.rightValue = 1;
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
    recompute(cy, nodeScale);
    cy.getElementById(id)?.select();
  };

  const hideContextMenu = () => {
    if (!contextMenu) {
      return;
    }
    contextMenu.style.display = 'none';
    pendingCreatePosition = null;
  };

  const hideEdgePortMenu = () => {
    if (!edgePortMenu) {
      return;
    }
    edgePortMenu.style.display = 'none';
    pendingEdgeTarget = null;
    pendingEdgeSource = null;
  };

  const showEdgePortMenu = (
    renderedPosition: { x: number; y: number },
    targetNode: NodeSingular,
    title: string,
    ports: { id: string; label: string }[],
  ) => {
    if (!edgePortMenu) {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.display = 'none';
      menu.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      container.appendChild(menu);
      edgePortMenu = menu;
    }

    if (!edgePortMenu) {
      return;
    }
    const menu = edgePortMenu;

    menu.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'context-menu-section';
    heading.textContent = title;
    menu.appendChild(heading);

    ports.forEach((port) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = port.label;
      button.addEventListener('click', () => {
        if (!pendingEdgeTarget || !pendingEdgeSource) {
          return;
        }
        if (pendingEdgeSource.id() === pendingEdgeTarget.id()) {
          hideEdgePortMenu();
          return;
        }
        const edgeId = `edge-${pendingEdgeSource.id()}-${pendingEdgeTarget.id()}-${Date.now()}`;
        cy.add({
          group: 'edges',
          data: {
            id: edgeId,
            source: pendingEdgeSource.id(),
            target: pendingEdgeTarget.id(),
            targetPort: port.id,
            kind: 'flow',
          },
        });
        recompute(cy, nodeScale);
        hideEdgePortMenu();
      });
      menu.appendChild(button);
    });

    pendingEdgeTarget = targetNode;
    menu.style.display = 'flex';
    menu.style.left = `${renderedPosition.x}px`;
    menu.style.top = `${renderedPosition.y}px`;

    const maxX = container.clientWidth - menu.offsetWidth - 8;
    const maxY = container.clientHeight - menu.offsetHeight - 8;
    const clampedX = Math.max(8, Math.min(renderedPosition.x, maxX));
    const clampedY = Math.max(8, Math.min(renderedPosition.y, maxY));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
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
    hideEdgePortMenu();
    const targetNode = event.target;
    const selectedNode = cy.nodes(':selected').first();
    if (!selectedNode || selectedNode.empty()) {
      return;
    }
    if (selectedNode.id() === targetNode.id()) {
      return;
    }
    const targetData = targetNode.data() as EconNodeData;
    if (isMathKind(targetData.kind)) {
      pendingEdgeSource = selectedNode;
      showEdgePortMenu(event.renderedPosition, targetNode, 'Select Input', [
        { id: '1', label: 'Input 1' },
        { id: '2', label: 'Input 2' },
      ]);
      return;
    }
    if (targetData.kind === 'custom') {
      const inputs = targetData.custom?.inputs ?? [];
      if (inputs.length > 0) {
        pendingEdgeSource = selectedNode;
        showEdgePortMenu(
          event.renderedPosition,
          targetNode,
          'Select Input',
          inputs.map((port) => ({ id: port.id, label: `${port.label} (${port.id})` })),
        );
        return;
      }
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
    recompute(cy, nodeScale);
  });

  cy.on('remove add', 'edge', () => {
    recompute(cy, nodeScale);
  });

  const handleGlobalPointerDown = (event: PointerEvent) => {
    if (
      (!contextMenu || contextMenu.style.display === 'none') &&
      (!edgePortMenu || edgePortMenu.style.display === 'none')
    ) {
      return;
    }
    const target = event.target as Node | null;
    if (
      (target && contextMenu && contextMenu.contains(target)) ||
      (target && edgePortMenu && edgePortMenu.contains(target))
    ) {
      return;
    }
    hideContextMenu();
    hideEdgePortMenu();
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
    recompute(cy, nodeScale);
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
    recompute(cy, nodeScale);
  };

  const importGraph = (data: GraphData) => {
    if (data.nodeScale !== undefined) {
      setNodeScale(data.nodeScale);
    }
    cy.elements().remove();
    cy.add(data.nodes.map((node) => toCyNodeElement(node)));
    cy.add(data.edges.map((edge) => ({ data: edge })));
    recompute(cy, nodeScale);
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
    setTimeout(() => recompute(cy, nodeScale), 0);
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
    setTimeout(() => recompute(cy, nodeScale), 0);
  };

  const exportGraph = (): GraphData => graphDataFromCy(cy, nodeScale);

  return {
    cy,
    updateNodeData,
    updateEdgeData,
    deleteNode,
    deleteEdge,
    importGraph,
    exportGraph,
    setNodeScale,
  };
};
