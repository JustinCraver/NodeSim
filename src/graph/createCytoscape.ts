import cytoscape, { type Core, type NodeSingular, type StylesheetJson } from 'cytoscape';
import type {
  EconEdgeData,
  EconNodeData,
  ComputeDiagnostic,
  GraphComputeResult,
  GraphData,
  NodeKind,
  SimulationSettingsV1,
} from '../models/types';
import { computeGraph } from '../engine/computeGraph';
import { validateConnection } from '../engine/connectionValidation';
import { DEFAULT_SIMULATION_SETTINGS } from '../document/graphDocument';
import type { DocumentCommand, DocumentSelection } from '../document/documentStore';
import { formatGraphPath, type GraphPath } from './graphScope';
import { ControllerLifecycle } from './controllerLifecycle';

type GraphCallbacks = {
  onSelectNode?: (node: EconNodeData | null) => void;
  onSelectEdge?: (edge: EconEdgeData | null) => void;
  onOpenCustomNode?: (node: EconNodeData) => void;
  onCommand?: (command: DocumentCommand, selection?: DocumentSelection) => void;
  onConnectionRejected?: (reason: string) => void;
  onDiagnostics?: (diagnostics: ComputeDiagnostic[]) => void;
  onGraphComputed?: (graph: GraphData, graphPath: GraphPath) => void;
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

const TEXT_NODE_OPTIONS: { kind: NodeKind; label: string }[] = [{ kind: 'text', label: 'Text' }];

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
const TEXT_BASE_FONT_SIZE = 18;
const TEXT_LINE_HEIGHT = 1.35;
const TEXT_MIN_WIDTH = 240;
const TEXT_MAX_WIDTH = 820;
const TEXT_HORIZONTAL_PADDING = 32;
const TEXT_VERTICAL_PADDING = 26;
const DEFAULT_NODE_SCALE = 2;

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

const formatOutputValue = (node: EconNodeData) => {
  if (node.outputState?.kind === 'unreachable') {
    return 'Unreachable';
  }
  const value = node.outputState?.kind === 'month' ? node.outputState.month : node.computedValue;
  if (value === undefined) {
    return '--';
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

type ThemePalette = {
  mode: 'light' | 'dark';
  node: {
    baseBg: string;
    baseBorder: string;
    baseText: string;
    noteText: string;
    selectedBg: string;
    selectedBorder: string;
    selectedText: string;
    hoverBorder: string;
  };
  edge: {
    base: string;
    selected: string;
    hoverGlow: string;
  };
  kinds: {
    expense: { bg: string; border: string };
    calc: { bg: string; border: string };
    asset: { bg: string; border: string };
    output: { bg: string; border: string };
    custom: { bg: string; border: string };
    text: { bg: string; border: string };
    value: { bg: string; border: string };
    add: { bg: string; border: string };
    subtract: { bg: string; border: string };
    multiply: { bg: string; border: string };
    divide: { bg: string; border: string };
  };
  port: {
    fill: string;
    stroke: string;
    text: string;
    glow: string;
  };
};

const readThemePalette = (): ThemePalette => {
  const styles = getComputedStyle(document.documentElement);
  const readVar = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const mode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  return {
    mode,
    node: {
      baseBg: readVar('--cy-node-bg', '#2563eb'),
      baseBorder: readVar('--cy-node-border', '#1e3a8a'),
      baseText: readVar('--cy-node-text', '#0f172a'),
      noteText: readVar('--cy-node-note-text', '#0f172a'),
      selectedBg: readVar('--cy-node-selected-bg', '#1d4ed8'),
      selectedBorder: readVar('--cy-node-selected-border', '#0ea5e9'),
      selectedText: readVar('--cy-node-selected-text', '#e2e8f0'),
      hoverBorder: readVar('--cy-node-hover-border', '#38bdf8'),
    },
    edge: {
      base: readVar('--cy-edge', '#94a3b8'),
      selected: readVar('--cy-edge-selected', '#0ea5e9'),
      hoverGlow: readVar('--cy-edge-hover-glow', '#3b82f6'),
    },
    kinds: {
      expense: {
        bg: readVar('--cy-node-expense-bg', '#f97316'),
        border: readVar('--cy-node-expense-border', '#c2410c'),
      },
      calc: {
        bg: readVar('--cy-node-calc-bg', '#22c55e'),
        border: readVar('--cy-node-calc-border', '#15803d'),
      },
      asset: {
        bg: readVar('--cy-node-asset-bg', '#eab308'),
        border: readVar('--cy-node-asset-border', '#a16207'),
      },
      output: {
        bg: readVar('--cy-node-output-bg', '#f472b6'),
        border: readVar('--cy-node-output-border', '#be185d'),
      },
      custom: {
        bg: readVar('--cy-node-custom-bg', '#a855f7'),
        border: readVar('--cy-node-custom-border', '#7e22ce'),
      },
      text: {
        bg: readVar('--cy-node-text-bg', '#f8fafc'),
        border: readVar('--cy-node-text-border', '#94a3b8'),
      },
      value: {
        bg: readVar('--cy-node-value-bg', '#64748b'),
        border: readVar('--cy-node-value-border', '#475569'),
      },
      add: {
        bg: readVar('--cy-node-add-bg', '#14b8a6'),
        border: readVar('--cy-node-add-border', '#0f766e'),
      },
      subtract: {
        bg: readVar('--cy-node-subtract-bg', '#ef4444'),
        border: readVar('--cy-node-subtract-border', '#b91c1c'),
      },
      multiply: {
        bg: readVar('--cy-node-multiply-bg', '#22d3ee'),
        border: readVar('--cy-node-multiply-border', '#0891b2'),
      },
      divide: {
        bg: readVar('--cy-node-divide-bg', '#f59e0b'),
        border: readVar('--cy-node-divide-border', '#b45309'),
      },
    },
    port: {
      fill: readVar('--cy-port-fill', '#0ea5e9'),
      stroke: readVar('--cy-port-stroke', '#0f172a'),
      text: readVar('--cy-port-text', '#0f172a'),
      glow: readVar('--cy-port-glow', '#38bdf8'),
    },
  };
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const parseHex = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }
  return { r: 255, g: 255, b: 255 };
};

const toHex = (value: number) => clampByte(value).toString(16).padStart(2, '0');

const adjustHex = (hex: string, amount: number) => {
  const { r, g, b } = parseHex(hex);
  if (amount >= 0) {
    return `#${toHex(r + (255 - r) * amount)}${toHex(g + (255 - g) * amount)}${toHex(b + (255 - b) * amount)}`;
  }
  const factor = 1 + amount;
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
};

const getNodeBg = (palette: ThemePalette, kind: NodeKind) => {
  switch (kind) {
    case 'expense':
      return palette.kinds.expense.bg;
    case 'calc':
      return palette.kinds.calc.bg;
    case 'asset':
      return palette.kinds.asset.bg;
    case 'output':
      return palette.kinds.output.bg;
    case 'custom':
      return palette.kinds.custom.bg;
    case 'text':
      return palette.kinds.text.bg;
    case 'value':
      return palette.kinds.value.bg;
    case 'add':
      return palette.kinds.add.bg;
    case 'subtract':
      return palette.kinds.subtract.bg;
    case 'multiply':
      return palette.kinds.multiply.bg;
    case 'divide':
      return palette.kinds.divide.bg;
    default:
      return palette.node.baseBg;
  }
};

const getGlowColor = (palette: ThemePalette, kind: NodeKind) => {
  const base = getNodeBg(palette, kind);
  const amount = palette.mode === 'dark' ? 0.35 : -0.35;
  return adjustHex(base, amount);
};

const buildPortOverlay = (node: EconNodeData, scale: number, palette: ThemePalette) => {
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
  const leftFill = node.input1Connected ? palette.port.fill : 'none';
  const rightFill = node.input2Connected ? palette.port.fill : 'none';
  const leftGlow = node.input1Connected ? 'url(#portGlow)' : 'none';
  const rightGlow = node.input2Connected ? 'url(#portGlow)' : 'none';
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    '<filter id="portGlow" x="-50%" y="-50%" width="200%" height="200%">',
    `<feDropShadow dx="0" dy="0" stdDeviation="${glowStd}" flood-color="${palette.port.glow}" flood-opacity="0.9" />`,
    '</filter>',
    '</defs>',
    `<circle cx="${leftX}" cy="${circleY}" r="${circleRadius}" fill="${leftFill}" stroke="${palette.port.stroke}" stroke-width="${circleStroke}" filter="${leftGlow}" />`,
    `<circle cx="${rightX}" cy="${circleY}" r="${circleRadius}" fill="${rightFill}" stroke="${palette.port.stroke}" stroke-width="${circleStroke}" filter="${rightGlow}" />`,
    `<text x="${leftX}" y="${textY}" text-anchor="middle" font-size="${textSize}" fill="${palette.port.text}">${left}</text>`,
    `<text x="${rightX}" y="${textY}" text-anchor="middle" font-size="${textSize}" fill="${palette.port.text}">${right}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const getTextWidth = (() => {
  let canvas: HTMLCanvasElement | null = null;
  let cachedFont = '';
  let cachedFamily = '';
  return (text: string) => {
    const fallback = text.length * TEXT_BASE_FONT_SIZE * 0.56;
    if (typeof document === 'undefined') {
      return fallback;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return fallback;
    }
    if (!cachedFamily) {
      cachedFamily = (document.body && getComputedStyle(document.body).fontFamily) || 'sans-serif';
    }
    const font = `${TEXT_BASE_FONT_SIZE}px ${cachedFamily}`;
    if (cachedFont !== font) {
      context.font = font;
      cachedFont = font;
    }
    return context.measureText(text).width;
  };
})();

const countWrappedLines = (line: string, maxWidth: number) => {
  if (!line.trim()) {
    return 1;
  }
  const words = line.split(/\s+/);
  let lines = 1;
  let current = '';
  const charWidth = Math.max(1, getTextWidth('M'));
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / charWidth));

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (getTextWidth(candidate) <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) {
      lines += 1;
      current = word;
    }
    if (getTextWidth(word) > maxWidth) {
      const extraLines = Math.ceil(word.length / maxCharsPerLine);
      lines += Math.max(0, extraLines - 1);
      current = '';
    }
  });

  return lines;
};

const splitLongToken = (token: string, maxWidth: number) => {
  if (getTextWidth(token) <= maxWidth) {
    return [token];
  }

  const chunks: string[] = [];
  let current = '';

  Array.from(token).forEach((char) => {
    const candidate = `${current}${char}`;
    if (current && getTextWidth(candidate) > maxWidth) {
      chunks.push(current);
      current = char;
      return;
    }
    current = candidate;
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const breakLongTextTokens = (text: string, maxWidth: number) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .split(/(\s+)/)
        .map((token) => (/\s+/.test(token) ? token : splitLongToken(token, maxWidth).join('\n')))
        .join(''),
    )
    .join('\n');

const buildTextLayout = (text: string, scale: number) => {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const contentMaxWidth = TEXT_MAX_WIDTH - TEXT_HORIZONTAL_PADDING;
  const contentMinWidth = TEXT_MIN_WIDTH - TEXT_HORIZONTAL_PADDING;
  const longestLine = Math.max(0, ...lines.map((line) => getTextWidth(line)));
  const contentWidth = Math.min(contentMaxWidth, Math.max(contentMinWidth, longestLine));
  const lineCount =
    longestLine <= contentWidth
      ? Math.max(1, lines.length)
      : lines.reduce((total, line) => total + countWrappedLines(line, contentWidth), 0);
  const baseHeight = Math.max(
    TEXT_BASE_FONT_SIZE * TEXT_LINE_HEIGHT + TEXT_VERTICAL_PADDING,
    lineCount * TEXT_BASE_FONT_SIZE * TEXT_LINE_HEIGHT + TEXT_VERTICAL_PADDING,
  );
  return {
    nodeWidth: scaleValue(contentWidth + TEXT_HORIZONTAL_PADDING, scale),
    nodeHeight: scaleValue(baseHeight, scale),
    textMaxWidth: scaleValue(contentWidth, scale),
  };
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
    case 'text':
      return node.label;
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
      suffix = formatOutputValue(node);
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

const applyComputeResults = (cy: Core, result: GraphComputeResult, scale: number, palette: ThemePalette) => {
  result.nodes.forEach((node) => {
    const element = cy.getElementById(node.id);
    if (element) {
      const error = result.errors[node.id];
      const portOverlay = isMathKind(node.kind) ? buildPortOverlay(node, scale, palette) : undefined;
      const glowColor = getGlowColor(palette, node.kind);
      const textLayout = node.kind === 'text' ? buildTextLayout(node.label, scale) : undefined;
      const displayLabel =
        node.kind === 'text' && textLayout
          ? breakLongTextTokens(node.label, textLayout.textMaxWidth / scale)
          : formatNodeLabel(node, error);
      element.data({
        ...node,
        displayLabel,
        portOverlay,
        glowColor,
        ...textLayout,
      });
    }
  });
};

const recompute = (
  cy: Core,
  scale: number,
  palette: ThemePalette,
  simulationSettings: SimulationSettingsV1,
  graphPath: string,
) => {
  const graphData = graphDataFromCy(cy, scale);
  const result = computeGraph(graphData.nodes, graphData.edges, simulationSettings, graphPath);
  cy.batch(() => applyComputeResults(cy, result, scale, palette));
  return result;
};

const buildStyles = (palette: ThemePalette) =>
  [
  {
    selector: 'node',
    style: {
      'background-color': palette.node.baseBg,
      label: 'data(displayLabel)',
      color: palette.node.baseText,
      'text-valign': 'center',
      'text-halign': 'center',
      'text-wrap': 'wrap',
      'text-max-width': `${BASE_TEXT_MAX_WIDTH}px`,
      'font-size': BASE_NODE_FONT_SIZE,
      'transition-property': 'opacity',
      'transition-duration': '180ms',
      'border-width': 2,
      'border-color': palette.node.baseBorder,
      width: BASE_NODE_WIDTH,
      height: BASE_NODE_HEIGHT,
      'shape': 'roundrectangle',
    },
  },
  {
    selector: 'node:selected',
    style: {
      'border-width': 10,
      'border-color': palette.node.selectedBorder,
      'background-color': palette.node.selectedBg,
      color: palette.node.selectedText,
      opacity: 1,
    },
  },
  {
    selector: 'node.hovered',
    style: {
      'border-width': 7,
      'border-color': palette.node.hoverBorder,
      opacity: 1,
    },
  },
  {
    selector: 'node.dimmed',
    style: {
      opacity: 0.75,
    },
  },
  {
    selector: 'edge',
    style: {
      width: 2,
      'line-color': palette.edge.base,
      'target-arrow-color': palette.edge.base,
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
      'line-color': palette.edge.selected,
      'target-arrow-color': palette.edge.selected,
    },
  },
  {
    selector: 'edge.hovered',
    style: {
      width: 3,
      'line-color': palette.edge.selected,
      'target-arrow-color': palette.edge.selected,
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
      'background-color': palette.kinds.expense.bg,
      'border-color': palette.kinds.expense.border,
    },
  },
  {
    selector: 'node[kind = "calc"]',
    style: {
      'background-color': palette.kinds.calc.bg,
      'border-color': palette.kinds.calc.border,
    },
  },
  {
    selector: 'node[kind = "asset"]',
    style: {
      'background-color': palette.kinds.asset.bg,
      'border-color': palette.kinds.asset.border,
    },
  },
  {
    selector: 'node[kind = "output"]',
    style: {
      'background-color': palette.kinds.output.bg,
      'border-color': palette.kinds.output.border,
    },
  },
  {
    selector: 'node[kind = "custom"]',
    style: {
      'background-color': palette.kinds.custom.bg,
      'border-color': palette.kinds.custom.border,
    },
  },
  {
    selector: 'node[kind = "text"]',
    style: {
      'background-color': palette.kinds.text.bg,
      'border-color': palette.kinds.text.border,
      width: 'data(nodeWidth)',
      height: 'data(nodeHeight)',
      'text-valign': 'center',
      'text-halign': 'center',
      'text-justification': 'left',
      'text-wrap': 'wrap',
      'text-max-width': 'data(textMaxWidth)',
      'font-size': TEXT_BASE_FONT_SIZE,
      color: palette.node.noteText,
    },
  },
  {
    selector: 'node[kind = "value"]',
    style: {
      'background-color': palette.kinds.value.bg,
      'border-color': palette.kinds.value.border,
    },
  },
  {
    selector: 'node[kind = "add"]',
    style: {
      'background-color': palette.kinds.add.bg,
      'border-color': palette.kinds.add.border,
    },
  },
  {
    selector: 'node[kind = "subtract"]',
    style: {
      'background-color': palette.kinds.subtract.bg,
      'border-color': palette.kinds.subtract.border,
    },
  },
  {
    selector: 'node[kind = "multiply"]',
    style: {
      'background-color': palette.kinds.multiply.bg,
      'border-color': palette.kinds.multiply.border,
    },
  },
  {
    selector: 'node[kind = "divide"]',
    style: {
      'background-color': palette.kinds.divide.bg,
      'border-color': palette.kinds.divide.border,
    },
  },
  ] as unknown as StylesheetJson;

export const createCytoscape = (
  container: HTMLDivElement,
  graphData: GraphData,
  callbacks: GraphCallbacks = {},
  initialSimulationSettings: SimulationSettingsV1 = DEFAULT_SIMULATION_SETTINGS,
) => {
  let themePalette = readThemePalette();

  const cy = cytoscape({
    container,
    elements: [],
    style: buildStyles(themePalette),
    layout: { name: 'preset' },
  });
  const lifecycle = new ControllerLifecycle(cy);
  lifecycle.listen(container, 'contextmenu', (event) => event.preventDefault());

  let nodeScale = Math.max(0.1, graphData.nodeScale ?? DEFAULT_NODE_SCALE);
  let simulationSettings = { ...initialSimulationSettings };
  let graphPath: GraphPath = Object.freeze([]);
  let isProjecting = false;

  const runRecompute = () => {
    const result = recompute(cy, nodeScale, themePalette, simulationSettings, formatGraphPath(graphPath));
    callbacks.onDiagnostics?.(result.diagnostics);
    callbacks.onGraphComputed?.(
      {
        nodes: result.nodes.map((node) => ({ ...node })),
        edges: cy.edges().map((edge) => ({ ...(edge.data() as EconEdgeData) })),
        nodeScale,
      },
      graphPath,
    );
    return result;
  };

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
      .selector('node[kind = "text"]')
      .style({
        width: 'data(nodeWidth)',
        height: 'data(nodeHeight)',
        'text-max-width': 'data(textMaxWidth)',
        'font-size': scaleValue(TEXT_BASE_FONT_SIZE, scale),
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

  applyNodeScale(nodeScale);

  const updateFocusDimming = () => {
    const hasFocused = cy.nodes(':selected, .hovered').length > 0;
    if (!hasFocused) {
      cy.nodes('.dimmed').removeClass('dimmed');
      return;
    }
    cy.nodes().not(':selected').not('.hovered').addClass('dimmed');
    cy.nodes(':selected, .hovered').removeClass('dimmed');
  };

  cy.on('select', 'node', (event) => {
    if (isProjecting) {
      return;
    }
    cy.edges(':selected').unselect();
    const node = event.target.data() as EconNodeData;
    callbacks.onSelectNode?.({ ...node });
    updateFocusDimming();
  });

  cy.on('unselect', 'node', () => {
    if (isProjecting) {
      return;
    }
    callbacks.onSelectNode?.(null);
    updateFocusDimming();
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
    updateFocusDimming();
  });

  cy.on('mouseout', 'node', (event) => {
    event.target.removeClass('hovered');
    updateFocusDimming();
  });

  cy.on('select', 'edge', (event) => {
    if (isProjecting) {
      return;
    }
    cy.nodes(':selected').unselect();
    const edge = event.target.data() as EconEdgeData;
    callbacks.onSelectEdge?.({ ...edge });
    updateFocusDimming();
  });

  cy.on('unselect', 'edge', () => {
    if (isProjecting) {
      return;
    }
    callbacks.onSelectEdge?.(null);
    updateFocusDimming();
  });

  cy.on('mouseover', 'edge', (event) => {
    event.target.addClass('hovered');
  });

  cy.on('mouseout', 'edge', (event) => {
    event.target.removeClass('hovered');
  });

  let nodeSequence = 1;
  let pendingCreatePosition: { x: number; y: number } | null = null;
  let contextMenu: HTMLDivElement | null = null;
  let edgePortMenu: HTMLDivElement | null = null;
  let pendingEdgeTarget: NodeSingular | null = null;
  let pendingEdgeSource: NodeSingular | null = null;
  let menuReturnFocus: HTMLElement | null = null;
  type ConnectionMenuOption = { label: string; sourcePort?: string; targetPort?: string };

  const focusFirstMenuItem = (menu: HTMLElement) => {
    lifecycle.requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
  };

  const handleMenuKeyDown = (menu: HTMLElement, event: KeyboardEvent, close: () => void) => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  };

  const createNodeAt = (position: { x: number; y: number } | undefined, kind: NodeKind) => {
    const id = `node_${Date.now()}_${nodeSequence}`;
    const label = kind === 'text' ? 'Text' : `Node ${cy.nodes().length + 1}`;
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
    if (kind === 'calc') {
      node.formula = '';
      node.outputType = 'scalar';
    }
    if (kind === 'asset') {
      node.initialBalance = 0;
      node.interestRateAnnual = 0;
    }
    if (kind === 'output') {
      node.targetAmount = 0;
    }
    if (kind === 'custom') {
      const inputPortId = 'in-1';
      const outputPortId = 'out-1';
      const internalInputId = 'internal_input';
      const internalOutputId = 'internal_output';
      node.custom = {
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
    }
    if (kind === 'text') {
      Object.assign(node, buildTextLayout(label, nodeScale));
    }
    if (position) {
      node.position = { ...position };
    }
    callbacks.onCommand?.(
      { type: 'add-node', graphPath, node },
      { graphPath, kind: 'node', id, focus: true },
    );
  };

  const hideContextMenu = (restoreFocus = false) => {
    if (!contextMenu) {
      return;
    }
    contextMenu.style.display = 'none';
    pendingCreatePosition = null;
    if (restoreFocus) {
      menuReturnFocus?.focus();
      menuReturnFocus = null;
    }
  };

  const hideEdgePortMenu = (restoreFocus = false) => {
    if (!edgePortMenu) {
      return;
    }
    edgePortMenu.style.display = 'none';
    pendingEdgeTarget = null;
    pendingEdgeSource = null;
    if (restoreFocus) {
      menuReturnFocus?.focus();
      menuReturnFocus = null;
    }
  };

  const showEdgePortMenu = (
    renderedPosition: { x: number; y: number },
    targetNode: NodeSingular,
    title: string,
    options: ConnectionMenuOption[],
  ) => {
    if (!edgePortMenu) {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.display = 'none';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Compatible connection ports');
      menu.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      menu.addEventListener('keydown', (event) => handleMenuKeyDown(menu, event, () => hideEdgePortMenu(true)));
      container.appendChild(menu);
      lifecycle.ownElement(menu);
      edgePortMenu = menu;
    }

    if (!edgePortMenu) {
      return;
    }
    const menu = edgePortMenu;

    menu.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'context-menu-section';
    heading.setAttribute('role', 'presentation');
    heading.textContent = title;
    menu.appendChild(heading);

    const addConnection = (option: { sourcePort?: string; targetPort?: string }) => {
      if (!pendingEdgeTarget || !pendingEdgeSource) {
        return false;
      }
      const edgeId = `edge-${pendingEdgeSource.id()}-${pendingEdgeTarget.id()}-${Date.now()}`;
      const candidate: EconEdgeData = {
        id: edgeId,
        source: pendingEdgeSource.id(),
        target: pendingEdgeTarget.id(),
        kind: 'flow',
        ...(option.sourcePort ? { sourcePort: option.sourcePort } : {}),
        ...(option.targetPort ? { targetPort: option.targetPort } : {}),
        weight: 1,
        lagMonths: 0,
      };
      const validation = validateConnection(graphDataFromCy(cy, nodeScale), candidate, simulationSettings);
      if (!validation.valid) {
        callbacks.onConnectionRejected?.(validation.reason);
        return false;
      }
      callbacks.onCommand?.(
        { type: 'add-edge', graphPath, edge: candidate },
        { graphPath, kind: 'edge', id: edgeId, focus: true },
      );
      return true;
    };

    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = option.label;
      button.addEventListener('click', () => {
        addConnection(option);
        hideEdgePortMenu(true);
      });
      menu.appendChild(button);
    });

    pendingEdgeTarget = targetNode;
    menuReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : container;
    menu.style.display = 'flex';
    menu.style.left = `${renderedPosition.x}px`;
    menu.style.top = `${renderedPosition.y}px`;

    const maxX = container.clientWidth - menu.offsetWidth - 8;
    const maxY = container.clientHeight - menu.offsetHeight - 8;
    const clampedX = Math.max(8, Math.min(renderedPosition.x, maxX));
    const clampedY = Math.max(8, Math.min(renderedPosition.y, maxY));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
    focusFirstMenuItem(menu);
  };

  const showContextMenu = (renderedPosition: { x: number; y: number }, position: { x: number; y: number }) => {
    if (!contextMenu) {
      const menu = document.createElement('div');
      menu.className = 'context-menu';
      menu.style.display = 'none';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Add node');
      menu.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      menu.addEventListener('keydown', (event) => handleMenuKeyDown(menu, event, () => hideContextMenu(true)));
      const addSection = (title: string, options: { kind: NodeKind; label: string }[]) => {
        const heading = document.createElement('div');
        heading.className = 'context-menu-section';
        heading.setAttribute('role', 'presentation');
        heading.textContent = title;
        menu.appendChild(heading);
        options.forEach((option) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('role', 'menuitem');
          button.textContent = option.label;
          button.addEventListener('click', () => {
            if (!pendingCreatePosition) {
              return;
            }
            createNodeAt(pendingCreatePosition, option.kind);
            hideContextMenu(true);
          });
          menu.appendChild(button);
        });
      };

      addSection('Basic Math', BASIC_NODE_OPTIONS);
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      divider.setAttribute('role', 'separator');
      menu.appendChild(divider);
      addSection('Economy', ECON_NODE_OPTIONS);
      const dividerText = document.createElement('div');
      dividerText.className = 'context-menu-divider';
      dividerText.setAttribute('role', 'separator');
      menu.appendChild(dividerText);
      addSection('Text', TEXT_NODE_OPTIONS);
      container.appendChild(menu);
      lifecycle.ownElement(menu);
      contextMenu = menu;
    }

    pendingCreatePosition = position;
    menuReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : container;
    contextMenu.style.display = 'flex';
    contextMenu.style.left = `${renderedPosition.x}px`;
    contextMenu.style.top = `${renderedPosition.y}px`;

    const maxX = container.clientWidth - contextMenu.offsetWidth - 8;
    const maxY = container.clientHeight - contextMenu.offsetHeight - 8;
    const clampedX = Math.max(8, Math.min(renderedPosition.x, maxX));
    const clampedY = Math.max(8, Math.min(renderedPosition.y, maxY));
    contextMenu.style.left = `${clampedX}px`;
    contextMenu.style.top = `${clampedY}px`;
    focusFirstMenuItem(contextMenu);
  };

  const addNodeAtViewportCenter = (kind: NodeKind) => {
    const extent = cy.extent();
    const centerX = (extent.x1 + extent.x2) / 2;
    const nodes = cy.nodes();
    const y = nodes.length === 0
      ? (extent.y1 + extent.y2) / 2
      : Math.max(...nodes.map((node) => node.position().y)) + scaleValue(BASE_NODE_HEIGHT, nodeScale) + 80;
    createNodeAt({ x: centerX, y }, kind);
  };

  lifecycle.listen(container, 'keydown', ((event: KeyboardEvent) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
      return;
    }
    event.preventDefault();
    const extent = cy.extent();
    showContextMenu(
      { x: container.clientWidth / 2, y: container.clientHeight / 2 },
      { x: (extent.x1 + extent.x2) / 2, y: (extent.y1 + extent.y2) / 2 },
    );
  }) as EventListener);

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
    const sourceData = selectedNode.data() as EconNodeData;
    const sourceOptions: ConnectionMenuOption[] =
      sourceData.kind === 'custom'
        ? (sourceData.custom?.outputs ?? []).map((port) => ({
            sourcePort: port.id,
            label: `${port.label} (${port.formulaId ?? port.id})`,
          }))
        : sourceData.kind === 'asset'
          ? [
              { sourcePort: 'balance', label: 'Balance series' },
              { sourcePort: 'endingBalance', label: 'Ending balance' },
            ]
          : [{ label: sourceData.label }];
    const targetOptions: ConnectionMenuOption[] = isMathKind(targetData.kind)
      ? [
          { targetPort: '1', label: 'Input 1' },
          { targetPort: '2', label: 'Input 2' },
        ]
      : targetData.kind === 'custom'
        ? (targetData.custom?.inputs ?? []).map((port) => ({
            targetPort: port.id,
            label: `${port.label} (${port.id})`,
          }))
        : [{ label: targetData.label }];
    const graph = graphDataFromCy(cy, nodeScale);
    const candidates: ConnectionMenuOption[] = sourceOptions.flatMap((sourceOption) =>
      targetOptions.map((targetOption) => ({
        ...sourceOption,
        ...targetOption,
        label:
          sourceOptions.length > 1 || targetOptions.length > 1
            ? `${sourceOption.label} to ${targetOption.label}`
            : 'Create connection',
      })),
    );
    const validOptions = candidates.filter((option) =>
      validateConnection(
        graph,
        {
          id: 'candidate-edge',
          source: selectedNode.id(),
          target: targetNode.id(),
          kind: 'flow',
          ...(option.sourcePort ? { sourcePort: option.sourcePort } : {}),
          ...(option.targetPort ? { targetPort: option.targetPort } : {}),
          weight: 1,
          lagMonths: 0,
        },
        simulationSettings,
      ).valid,
    );
    if (validOptions.length === 0) {
      const first = candidates[0];
      const validation = validateConnection(
        graph,
        {
          id: 'candidate-edge',
          source: selectedNode.id(),
          target: targetNode.id(),
          kind: 'flow',
          ...(first?.sourcePort ? { sourcePort: first.sourcePort } : {}),
          ...(first?.targetPort ? { targetPort: first.targetPort } : {}),
          weight: 1,
          lagMonths: 0,
        },
        simulationSettings,
      );
      callbacks.onConnectionRejected?.(validation.valid ? 'No compatible ports are available.' : validation.reason);
      return;
    }
    pendingEdgeSource = selectedNode;
    pendingEdgeTarget = targetNode;
    showEdgePortMenu(event.renderedPosition, targetNode, 'Select compatible ports', validOptions);
  });

  cy.on('dragfree', 'node', (event) => {
    const position = event.target.position();
    callbacks.onCommand?.({
      type: 'move-node',
      graphPath,
      nodeId: event.target.id(),
      position: { x: position.x, y: position.y },
    });
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

  lifecycle.listen(document, 'pointerdown', handleGlobalPointerDown as EventListener, true);
  lifecycle.listen(container, 'scroll', (() => hideContextMenu()) as EventListener);

  const projectGraph = (
    data: GraphData,
    nextGraphPath: GraphPath = Object.freeze([]),
    selection?: DocumentSelection,
    nextSimulationSettings: SimulationSettingsV1 = simulationSettings,
  ) => {
    const canReuseRenderedPositions =
      graphPath.length === nextGraphPath.length && graphPath.every((part, index) => part === nextGraphPath[index]);
    const renderedPositions = canReuseRenderedPositions
      ? new Map(cy.nodes().map((node) => [node.id(), { ...node.position() }]))
      : new Map<string, { x: number; y: number }>();
    const projectedNodes = data.nodes.map((node) =>
      hasValidPosition(node.position) || !renderedPositions.has(node.id)
        ? node
        : { ...node, position: renderedPositions.get(node.id)! },
    );
    graphPath = Object.freeze([...nextGraphPath]);
    simulationSettings = { ...nextSimulationSettings };
    if (data.nodeScale !== undefined) {
      nodeScale = Math.max(0.1, data.nodeScale);
      applyNodeScale(nodeScale);
    }
    isProjecting = true;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(projectedNodes.map((node) => toCyNodeElement(node)));
      cy.add(data.edges.map((edge) => ({ data: edge })));
    });
    runRecompute();
    const hasPositions = hasMeaningfulPositions(projectedNodes);
    if (hasPositions) {
      cy.layout({ name: 'preset' }).run();
    } else {
      cy.layout({ name: 'breadthfirst', directed: true, spacingFactor: 1.4 }).run();
    }
    if (data.nodes.length > 0) {
      cy.fit(undefined, 40);
    }
    if (selection && selection.graphPath.length === graphPath.length && selection.graphPath.every((part, index) => part === graphPath[index])) {
      const element = cy.getElementById(selection.id);
      if (element && !element.empty()) {
        element.select();
      }
    }
    isProjecting = false;
  };

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver((mutations) => {
      if (lifecycle.isDestroyed()) {
        return;
      }
      if (!mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'data-theme')) {
        return;
      }
      themePalette = readThemePalette();
      cy.style().fromJson(buildStyles(themePalette)).update();
      applyNodeScale(nodeScale);
      runRecompute();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    lifecycle.observe(observer);
  }

  const destroy = () => {
    lifecycle.destroy();
    contextMenu = null;
    edgePortMenu = null;
    pendingCreatePosition = null;
    pendingEdgeSource = null;
    pendingEdgeTarget = null;
  };

  return {
    cy,
    addNode: addNodeAtViewportCenter,
    projectGraph,
    destroy,
  };
};
