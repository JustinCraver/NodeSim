import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import ReactGridLayout, {
  useContainerWidth,
  type Compactor,
  type Layout,
  type LayoutItem,
  type ResizeHandleAxis,
} from 'react-grid-layout';
import type {
  ComputeDiagnostic,
  EconEdgeData,
  EconNodeData,
  GraphData,
  GraphDocument,
  NodeKind,
  SimulationSettingsV1,
} from './models/types';
import { createCytoscape } from './graph/createCytoscape';
import { validateConnection } from './engine/connectionValidation';
import { GraphDocumentStorage } from './document/documentStorage';
import {
  GraphDocumentStore,
  type DocumentCommand,
  type DocumentSelection,
  type DocumentStoreSnapshot,
} from './document/documentStore';
import {
  graphDocumentToRuntimeGraph,
  MAX_HORIZON_MONTHS,
  migrateGraphDocument,
  parseGraphDocumentText,
} from './document/graphDocument';
import {
  appendGraphPath,
  buildBreadcrumbs,
  buildViewStack,
  currentGraphPath,
  formatGraphPath,
  getGraphAtPath,
  graphPathsEqual,
  replaceGraphAtPath,
  scopedNodeKey,
  type GraphViewFrame,
  type ScopedNodeIdentity,
} from './graph/graphScope';
import { HierarchyPanel } from './ui/HierarchyPanel';
import { InspectorPanel } from './ui/InspectorPanel';
import { Toolbar } from './ui/Toolbar';
import { WorkspacePanel } from './ui/WorkspacePanel';
import demoGraph from './demo/houseFund.json';
import 'react-grid-layout/css/styles.css';
import './styles.css';

const DEFAULT_NODE_SCALE = 2;
const COMPACT_WORKSPACE_QUERY = '(max-width: 1100px)';
const AUTOSAVE_DEBOUNCE_MS = 250;
const WORKSPACE_STORAGE_KEY = 'nodesim.workspace.v1';
const LEGACY_WORKSPACE_STORAGE_KEY = 'econgraph.workspace.v1';
const WORKSPACE_GRID_COLS = 12;
const WORKSPACE_MIN_ROWS = 30;
const WORKSPACE_ROW_HEIGHT = 36;
const WORKSPACE_GRID_MARGIN: [number, number] = [12, 12];
const WORKSPACE_GRID_PADDING: [number, number] = [12, 12];
const WORKSPACE_RESIZE_HANDLES: ResizeHandleAxis[] = ['w', 's', 'e', 'se'];
const doLayoutItemsOverlap = (first: LayoutItem, second: LayoutItem) =>
  first.x < second.x + second.w &&
  first.x + first.w > second.x &&
  first.y < second.y + second.h &&
  first.y + first.h > second.y;

const workspaceCompactor: Compactor = {
  type: 'vertical',
  allowOverlap: false,
  compact: (layout) => {
    const nextLayout = layout.map((item) => ({ ...item }));
    const orderedItems = [...nextLayout].sort((first, second) => {
      if (first.moved !== second.moved) {
        return first.moved ? -1 : 1;
      }
      if (first.y !== second.y) {
        return first.y - second.y;
      }
      return first.x - second.x;
    });
    const placedItems: LayoutItem[] = [];

    orderedItems.forEach((item) => {
      let collision = placedItems.find((placed) => doLayoutItemsOverlap(placed, item));
      while (collision) {
        item.y = collision.y + collision.h;
        collision = placedItems.find((placed) => doLayoutItemsOverlap(placed, item));
      }
      placedItems.push(item);
    });

    return nextLayout;
  },
};

type GraphController = ReturnType<typeof createCytoscape>;
type PanelType = 'graph' | 'hierarchy' | 'inspector';
type PanelInstance = {
  id: string;
  type: PanelType;
  title: string;
};
type WorkspaceState = {
  panels: PanelInstance[];
  layout: LayoutItem[];
};
type InitialDocumentState = {
  document: GraphDocument;
  status: string;
};

type ConnectionCandidate = { sourcePort?: string; targetPort?: string };

const getConnectionCandidates = (source: EconNodeData, target: EconNodeData): ConnectionCandidate[] => {
  const sourceOptions: ConnectionCandidate[] = source.kind === 'custom'
    ? (source.custom?.outputs ?? []).map((port) => ({ sourcePort: port.id }))
    : source.kind === 'asset'
      ? [{ sourcePort: 'balance' }, { sourcePort: 'endingBalance' }]
      : [{}];
  const targetOptions: ConnectionCandidate[] =
    target.kind === 'add' || target.kind === 'subtract' || target.kind === 'multiply' || target.kind === 'divide'
      ? [{ targetPort: '1' }, { targetPort: '2' }]
      : target.kind === 'custom'
        ? (target.custom?.inputs ?? []).map((port) => ({ targetPort: port.id }))
        : [{}];
  return sourceOptions.flatMap((sourceOption) =>
    targetOptions.map((targetOption) => ({ ...sourceOption, ...targetOption })),
  );
};

const loadInitialDocument = (): InitialDocumentState => {
  if (typeof window === 'undefined') {
    return { document: migrateGraphDocument(demoGraph), status: 'Demo loaded' };
  }
  const loaded = new GraphDocumentStorage(window.localStorage).load(demoGraph as GraphData);
  return {
    document: loaded.document,
    status: loaded.warning ?? (loaded.source === 'fallback' ? 'Demo loaded' : 'Saved document restored'),
  };
};

const PANEL_TYPE_LABELS: Record<PanelType, string> = {
  graph: 'Graph',
  hierarchy: 'Hierarchy',
  inspector: 'Inspector',
};

const isPanelType = (value: unknown): value is PanelType =>
  value === 'graph' || value === 'hierarchy' || value === 'inspector';

const clampGridNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(Math.max(numberValue, min), max);
};

const getDefaultLayoutItem = (panel: PanelInstance, index: number, y = 0): LayoutItem => {
  if (panel.type === 'graph') {
    return {
      i: panel.id,
      x: 3,
      y,
      w: 6,
      h: 15,
      minW: 4,
      minH: 8,
      static: false,
      isDraggable: true,
      isResizable: true,
      resizeHandles: [...WORKSPACE_RESIZE_HANDLES],
    };
  }
  if (panel.type === 'hierarchy') {
    return {
      i: panel.id,
      x: 0,
      y,
      w: 3,
      h: 15,
      minW: 2,
      minH: 7,
      static: false,
      isDraggable: true,
      isResizable: true,
      resizeHandles: [...WORKSPACE_RESIZE_HANDLES],
    };
  }
  return {
    i: panel.id,
    x: index === 2 ? 9 : 6,
    y,
    w: 3,
    h: 15,
    minW: 3,
    minH: 8,
    static: false,
    isDraggable: true,
    isResizable: true,
    resizeHandles: [...WORKSPACE_RESIZE_HANDLES],
  };
};

const getDefaultWorkspaceState = (): WorkspaceState => {
  const panels: PanelInstance[] = [
    { id: 'hierarchy-main', type: 'hierarchy', title: 'Hierarchy' },
    { id: 'graph-main', type: 'graph', title: 'Graph' },
    { id: 'inspector-main', type: 'inspector', title: 'Inspector' },
  ];

  return {
    panels,
    layout: panels.map((panel, index) => getDefaultLayoutItem(panel, index)),
  };
};

const getLayoutBottom = (layout: readonly LayoutItem[]) =>
  layout.reduce((bottom, item) => Math.max(bottom, item.y + item.h), 0);

const sanitizeLayoutItem = (item: LayoutItem | undefined, fallback: LayoutItem): LayoutItem => {
  const minW = fallback.minW ?? 1;
  const minH = fallback.minH ?? 1;
  const maxW = fallback.maxW ?? WORKSPACE_GRID_COLS;
  const maxH = fallback.maxH ?? 100;
  const w = clampGridNumber(item?.w, minW, Math.min(maxW, WORKSPACE_GRID_COLS), fallback.w);
  const h = clampGridNumber(item?.h, minH, maxH, fallback.h);
  const x = clampGridNumber(item?.x, 0, Math.max(0, WORKSPACE_GRID_COLS - w), fallback.x);
  const y = clampGridNumber(item?.y, 0, 1000, fallback.y);

  return {
    ...fallback,
    i: fallback.i,
    x,
    y,
    w,
    h,
    minW,
    minH,
    maxW: fallback.maxW,
    maxH: fallback.maxH,
    static: false,
    isDraggable: true,
    isResizable: true,
    isBounded: true,
    resizeHandles: [...WORKSPACE_RESIZE_HANDLES],
  };
};

const cloneLayoutItem = (item: LayoutItem): LayoutItem =>
  sanitizeLayoutItem(item, {
    i: item.i,
    x: 0,
    y: 0,
    w: Math.max(1, Math.min(item.w, WORKSPACE_GRID_COLS)),
    h: Math.max(1, item.h),
    minW: item.minW ?? 1,
    minH: item.minH ?? 1,
  });

const isLayoutItem = (value: unknown): value is LayoutItem => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<LayoutItem>;
  return (
    typeof item.i === 'string' &&
    typeof item.x === 'number' &&
    typeof item.y === 'number' &&
    typeof item.w === 'number' &&
    typeof item.h === 'number'
  );
};

const areLayoutsEqual = (first: readonly LayoutItem[], second: readonly LayoutItem[]) => {
  if (first.length !== second.length) {
    return false;
  }

  return first.every((item, index) => {
    const other = second[index];
    return (
      other &&
      item.i === other.i &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });
};

const createPanelInstance = (type: Exclude<PanelType, 'graph'>, existingPanels: readonly PanelInstance[]) => {
  const count = existingPanels.filter((panel) => panel.type === type).length + 1;
  const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return {
    id,
    type,
    title: count === 1 ? PANEL_TYPE_LABELS[type] : `${PANEL_TYPE_LABELS[type]} ${count}`,
  };
};

const repairWorkspaceState = (state: Partial<WorkspaceState>): WorkspaceState => {
  const rawPanels = Array.isArray(state.panels) ? state.panels : [];
  const sidePanels = rawPanels
    .filter((panel): panel is PanelInstance => {
      if (!panel || typeof panel !== 'object') {
        return false;
      }
      const candidate = panel as Partial<PanelInstance>;
      return (
        typeof candidate.id === 'string' &&
        candidate.id !== 'graph-main' &&
        isPanelType(candidate.type) &&
        candidate.type !== 'graph'
      );
    })
    .map((panel) => ({
      id: panel.id,
      type: panel.type,
      title: typeof panel.title === 'string' && panel.title.trim() ? panel.title : PANEL_TYPE_LABELS[panel.type],
    }));
  const panels: PanelInstance[] = [
    ...sidePanels.filter((panel) => panel.type === 'hierarchy'),
    { id: 'graph-main', type: 'graph', title: 'Graph' },
    ...sidePanels.filter((panel) => panel.type === 'inspector'),
  ];
  const panelIds = new Set(panels.map((panel) => panel.id));
  const rawLayout = Array.isArray(state.layout) ? state.layout : [];
  const layoutById = new Map(
    rawLayout
      .filter((item): item is LayoutItem => isLayoutItem(item) && panelIds.has(item.i))
      .map((item) => [item.i, item]),
  );
  const repairedLayout: LayoutItem[] = [];

  panels.forEach((panel, index) => {
    const storedItem = layoutById.get(panel.id);
    const fallbackItem = getDefaultLayoutItem(panel, index, getLayoutBottom(repairedLayout));
    repairedLayout.push(sanitizeLayoutItem(storedItem, fallbackItem));
  });

  return { panels, layout: repairedLayout };
};

const loadWorkspaceState = (): WorkspaceState => {
  if (typeof window === 'undefined') {
    return getDefaultWorkspaceState();
  }
  const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
    ?? window.localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);
  if (!stored) {
    return getDefaultWorkspaceState();
  }
  try {
    return repairWorkspaceState(JSON.parse(stored) as Partial<WorkspaceState>);
  } catch {
    return getDefaultWorkspaceState();
  }
};

const getInitialTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

const getInitialCompactMode = () =>
  typeof window !== 'undefined' && window.matchMedia?.(COMPACT_WORKSPACE_QUERY).matches;

export const App = () => {
  const [initialDocumentState] = useState<InitialDocumentState>(loadInitialDocument);
  const initialGraphRef = useRef<GraphData>(graphDocumentToRuntimeGraph(initialDocumentState.document));
  const storeRef = useRef<GraphDocumentStore>(new GraphDocumentStore(initialDocumentState.document));
  const [storeSnapshot, setStoreSnapshot] = useState<DocumentStoreSnapshot>(storeRef.current.getSnapshot());
  const storageRef = useRef<GraphDocumentStorage | null>(
    typeof window === 'undefined' ? null : new GraphDocumentStorage(window.localStorage),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const animationFramesRef = useRef<Set<number>>(new Set());
  const projectedRevisionRef = useRef(storeSnapshot.revision);
  const { width: workspaceWidth, containerRef: workspaceContainerRef, mounted: isWorkspaceMounted } = useContainerWidth();
  const [selectedNode, setSelectedNode] = useState<EconNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EconEdgeData | null>(null);
  const [nodeScale, setNodeScale] = useState(initialGraphRef.current.nodeScale ?? DEFAULT_NODE_SCALE);
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettingsV1>(
    initialDocumentState.document.settings.simulation,
  );
  const [documentStatus, setDocumentStatus] = useState(initialDocumentState.status);
  const [isDocumentDirty, setIsDocumentDirty] = useState(false);
  const [viewStack, setViewStack] = useState<GraphViewFrame[]>([]);
  const viewStackRef = useRef<GraphViewFrame[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<ScopedNodeIdentity | undefined>();
  const [diagnostics, setDiagnostics] = useState<ComputeDiagnostic[]>([]);
  const [graphSnapshot, setGraphSnapshot] = useState<GraphData>(initialGraphRef.current);
  const [isHierarchyFocusEnabled, setIsHierarchyFocusEnabled] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(loadWorkspaceState);
  const [isCompactWorkspace, setIsCompactWorkspace] = useState(getInitialCompactMode);
  const [activeCompactTab, setActiveCompactTab] = useState<PanelType>('graph');

  const scheduleFrame = useCallback((callback: () => void) => {
    const frame = window.requestAnimationFrame(() => {
      animationFramesRef.current.delete(frame);
      callback();
    });
    animationFramesRef.current.add(frame);
    return frame;
  }, []);
  const scheduleGraphResize = useCallback(() => {
    scheduleFrame(() => controllerRef.current?.cy.resize());
  }, [scheduleFrame]);

  useEffect(() => () => {
    animationFramesRef.current.forEach((frame) => window.cancelAnimationFrame(frame));
    animationFramesRef.current.clear();
  }, []);
  const setWorkspaceHostRef = useCallback(
    (element: HTMLDivElement | null) => {
      (workspaceContainerRef as MutableRefObject<HTMLDivElement | null>).current = element;
    },
    [workspaceContainerRef],
  );

  const executeCommand = (command: DocumentCommand, selection?: DocumentSelection | null) => {
    try {
      if (selection === null) {
        storeRef.current.execute(command, undefined);
      } else if (selection) {
        storeRef.current.execute(command, selection);
      } else {
        storeRef.current.execute(command);
      }
      return true;
    } catch (error) {
      setDocumentStatus(error instanceof Error ? error.message : 'Command rejected');
      return false;
    }
  };

  const selectNode = (nodeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      return false;
    }
    const node = controller.cy.getElementById(nodeId);
    if (!node || node.empty()) {
      return false;
    }
    controller.cy.edges(':selected').unselect();
    controller.cy.nodes(':selected').not(node).unselect();
    node.select();
    return true;
  };

  const focusNode = (nodeId: string) => {
    const controller = controllerRef.current;
    if (!controller || !selectNode(nodeId)) {
      return false;
    }
    const node = controller.cy.getElementById(nodeId);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      controller.cy.center(node);
    } else {
      controller.cy.animate(
        { center: { eles: node }, zoom: controller.cy.zoom() },
        { duration: 220 },
      );
    }
    return true;
  };

  const openCustomNode = (node: EconNodeData) => {
    if (node.kind !== 'custom' || !node.custom) {
      return false;
    }
    const controller = controllerRef.current;
    if (!controller) {
      return false;
    }
    const rootGraph = graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document);
    const parentPath = currentGraphPath(viewStackRef.current);
    const parentGraph = getGraphAtPath(rootGraph, parentPath);
    const frame: GraphViewFrame = Object.freeze({
      parentPath,
      parentGraph,
      customNodeId: node.id,
      customNodeLabel: node.label || node.id,
    });
    const nextStack = [...viewStackRef.current, frame];
    viewStackRef.current = nextStack;
    setViewStack(nextStack);
    const nextPath = appendGraphPath(parentPath, node.id);
    storeRef.current.setSelection(undefined);
    controller.projectGraph(
      getGraphAtPath(rootGraph, nextPath),
      nextPath,
      undefined,
      storeRef.current.getSnapshot().document.settings.simulation,
    );
    setGraphSnapshot(rootGraph);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectedIdentity(undefined);
    return true;
  };

  const handleOpenCustomNode = (node: EconNodeData) => {
    openCustomNode(node);
  };

  useEffect(() => {
    if (!containerRef.current || controllerRef.current) {
      return;
    }
    controllerRef.current = createCytoscape(containerRef.current, initialGraphRef.current, {
      onSelectNode: (node) => {
        setSelectedNode(node);
        if (node) {
          const path = currentGraphPath(viewStackRef.current);
          setSelectedIdentity(Object.freeze({ graphPath: path, nodeId: node.id }));
          setSelectedEdge(null);
          storeRef.current.setSelection({ graphPath: path, kind: 'node', id: node.id, focus: true });
        } else {
          setSelectedIdentity(undefined);
          if (storeRef.current.getSnapshot().selection?.kind === 'node') {
            storeRef.current.setSelection(undefined);
          }
        }
      },
      onSelectEdge: (edge) => {
        setSelectedEdge(edge);
        if (edge) {
          setSelectedNode(null);
          setSelectedIdentity(undefined);
          const path = currentGraphPath(viewStackRef.current);
          storeRef.current.setSelection({ graphPath: path, kind: 'edge', id: edge.id, focus: true });
        } else if (storeRef.current.getSnapshot().selection?.kind === 'edge') {
          storeRef.current.setSelection(undefined);
        }
      },
      onOpenCustomNode: handleOpenCustomNode,
      onCommand: executeCommand,
      onConnectionRejected: (reason) => setDocumentStatus(`Connection rejected: ${reason}`),
      onDiagnostics: setDiagnostics,
      onGraphComputed: (computedGraph, path) => {
        setGraphSnapshot((rootGraph) => replaceGraphAtPath(rootGraph, path, computedGraph));
      },
    }, simulationSettings);
    const projectSnapshot = (snapshot: DocumentStoreSnapshot) => {
      const rootGraph = graphDocumentToRuntimeGraph(snapshot.document);
      let path = currentGraphPath(viewStackRef.current);
      if (snapshot.selection && !graphPathsEqual(snapshot.selection.graphPath, path)) {
        try {
          const nextStack = buildViewStack(rootGraph, snapshot.selection.graphPath);
          path = snapshot.selection.graphPath;
          viewStackRef.current = nextStack;
          setViewStack(nextStack);
        } catch {
          path = Object.freeze([]);
          viewStackRef.current = [];
          setViewStack([]);
        }
      }
      let activeGraph: GraphData;
      try {
        activeGraph = getGraphAtPath(rootGraph, path);
      } catch {
        path = Object.freeze([]);
        viewStackRef.current = [];
        setViewStack([]);
        activeGraph = rootGraph;
      }
      setGraphSnapshot(rootGraph);
      controllerRef.current?.projectGraph(
        activeGraph,
        path,
        snapshot.selection,
        snapshot.document.settings.simulation,
      );
      setNodeScale(rootGraph.nodeScale ?? DEFAULT_NODE_SCALE);
      setSimulationSettings(snapshot.document.settings.simulation);
      if (snapshot.selection?.kind === 'node' && graphPathsEqual(snapshot.selection.graphPath, path)) {
        const data = controllerRef.current?.cy.getElementById(snapshot.selection.id)?.data() as EconNodeData | undefined;
        setSelectedNode(data ? { ...data } : null);
        setSelectedEdge(null);
        setSelectedIdentity(Object.freeze({ graphPath: path, nodeId: snapshot.selection.id }));
      } else if (snapshot.selection?.kind === 'edge' && graphPathsEqual(snapshot.selection.graphPath, path)) {
        const data = controllerRef.current?.cy.getElementById(snapshot.selection.id)?.data() as EconEdgeData | undefined;
        setSelectedEdge(data ? { ...data } : null);
        setSelectedNode(null);
        setSelectedIdentity(undefined);
      } else {
        setSelectedNode(null);
        setSelectedEdge(null);
        setSelectedIdentity(undefined);
      }
    };
    projectSnapshot(storeRef.current.getSnapshot());
    const unsubscribe = storeRef.current.subscribe((snapshot) => {
      setStoreSnapshot(snapshot);
      if (snapshot.revision !== projectedRevisionRef.current) {
        projectedRevisionRef.current = snapshot.revision;
        projectSnapshot(snapshot);
        setIsDocumentDirty(true);
        setDocumentStatus('Unsaved changes');
      }
    });
    scheduleGraphResize();
    return () => {
      unsubscribe();
      const controller = controllerRef.current;
      controllerRef.current = null;
      controller?.destroy();
    };
  }, [isWorkspaceMounted, isCompactWorkspace, scheduleGraphResize]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_WORKSPACE_QUERY);
    const update = () => setIsCompactWorkspace(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isDocumentDirty) {
      return;
    }
    const timeout = window.setTimeout(() => {
      try {
        const revision = storageRef.current?.save(storeSnapshot.document);
        setIsDocumentDirty(false);
        setDocumentStatus(revision ? `Saved revision ${revision}` : 'Document validated');
      } catch (error) {
        setDocumentStatus(`Autosave blocked: ${error instanceof Error ? error.message : 'invalid document'}`);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [isDocumentDirty, storeSnapshot.document]);

  const handleNodeChange = (nodeId: string, data: Partial<EconNodeData>) => {
    const path = currentGraphPath(viewStackRef.current);
    const root = graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document);
    const current = getGraphAtPath(root, path).nodes.find((node) => node.id === nodeId);
    if (!current) {
      return;
    }
    const selection: DocumentSelection = { graphPath: path, kind: 'node', id: nodeId, focus: true };
    if (data.kind && data.kind !== current.kind) {
      executeCommand({ type: 'change-node-type', graphPath: path, nodeId, changes: data }, selection);
      return;
    }
    if (data.custom && current.kind === 'custom' && current.custom) {
      if (JSON.stringify(data.custom.internalGraph) !== JSON.stringify(current.custom.internalGraph)) {
        executeCommand(
          { type: 'replace-nested-graph', graphPath: appendGraphPath(path, nodeId), graph: data.custom.internalGraph },
          selection,
        );
      } else {
        executeCommand({ type: 'update-custom-ports', graphPath: path, nodeId, custom: data.custom }, selection);
      }
      return;
    }
    executeCommand({ type: 'update-node', graphPath: path, nodeId, changes: data }, selection);
  };

  const handleNodeDelete = (nodeId: string) => {
    const label = getNodeById(nodeId)?.label || nodeId;
    if (executeCommand({ type: 'delete-node', graphPath: currentGraphPath(viewStackRef.current), nodeId }, null)) {
      setDocumentStatus(`Deleted ${label} and its connections. Undo is available.`);
    }
  };

  const handleEdgeDelete = (edgeId: string) => {
    if (executeCommand({ type: 'delete-edge', graphPath: currentGraphPath(viewStackRef.current), edgeId }, null)) {
      setDocumentStatus('Deleted connection. Undo is available.');
    }
  };

  const navigateToDepth = (targetDepth: number, shouldFocusNode = true) => {
    const controller = controllerRef.current;
    if (!controller || targetDepth < 0 || targetDepth >= viewStackRef.current.length) {
      return;
    }
    const rootGraph = graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document);
    const previousStack = viewStackRef.current;
    const nextStack = previousStack.slice(0, targetDepth);
    const leavingFrame = previousStack[targetDepth];
    const nextSelection: ScopedNodeIdentity | undefined = leavingFrame
      ? Object.freeze({ graphPath: leavingFrame.parentPath, nodeId: leavingFrame.customNodeId })
      : undefined;
    viewStackRef.current = nextStack;
    setViewStack(nextStack);
    const nextPath = currentGraphPath(nextStack);
    const currentGraph = getGraphAtPath(rootGraph, nextPath);
    controller.projectGraph(
      currentGraph,
      nextPath,
      nextSelection ? { ...nextSelection, kind: 'node', id: nextSelection.nodeId, focus: shouldFocusNode } : undefined,
      storeRef.current.getSnapshot().document.settings.simulation,
    );
    const updatedCustom = nextSelection
      ? currentGraph.nodes.find((node) => node.id === nextSelection.nodeId) ?? null
      : null;
    setSelectedNode(updatedCustom ? { ...updatedCustom } : null);
    setSelectedEdge(null);
    setSelectedIdentity(nextSelection);
    setGraphSnapshot(rootGraph);
    storeRef.current.setSelection(
      nextSelection ? { graphPath: nextSelection.graphPath, kind: 'node', id: nextSelection.nodeId, focus: shouldFocusNode } : undefined,
    );
    if (shouldFocusNode && nextSelection) {
      scheduleFrame(() => focusNode(nextSelection.nodeId));
    }
  };

  const handleBack = () => navigateToDepth(viewStackRef.current.length - 1);

  const handleEdgeChange = (edgeId: string, data: Partial<EconEdgeData>) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const path = currentGraphPath(viewStackRef.current);
    const currentGraph = getGraphAtPath(
      graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document),
      path,
    );
    const currentEdge = currentGraph.edges.find((edge) => edge.id === edgeId);
    if (!currentEdge) {
      return;
    }
    const candidate = { ...currentEdge, ...data };
    const validation = validateConnection(
      { ...currentGraph, edges: currentGraph.edges.filter((edge) => edge.id !== edgeId) },
      candidate,
      simulationSettings,
    );
    if (!validation.valid) {
      setDocumentStatus(`Connection rejected: ${validation.reason}`);
      return;
    }
    executeCommand(
      { type: 'update-edge', graphPath: path, edgeId, changes: data },
      { graphPath: path, kind: 'edge', id: edgeId, focus: true },
    );
  };

  const getNodeById = (nodeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      return null;
    }
    const data = controller.cy.getElementById(nodeId)?.data() as EconNodeData | undefined;
    return data ? { ...data } : null;
  };

  const handleExport = () => storeRef.current.getSnapshot().document;

  const handleAddNode = (kind: NodeKind) => {
    controllerRef.current?.addNode(kind);
    setDocumentStatus(`Added ${kind} node. Edit it in the Inspector; Undo is available.`);
  };

  const handleConnectNodes = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId) {
      return 'Choose both a source and a target.';
    }
    if (sourceId === targetId) {
      return 'Choose two different nodes.';
    }
    const path = currentGraphPath(viewStackRef.current);
    const graph = getGraphAtPath(graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document), path);
    const source = graph.nodes.find((node) => node.id === sourceId);
    const target = graph.nodes.find((node) => node.id === targetId);
    if (!source || !target) {
      return 'The selected node is no longer available.';
    }
    const baseId = `edge-${sourceId}-${targetId}-${Date.now()}`;
    const candidate = getConnectionCandidates(source, target)
      .map((ports, index) => ({
        id: `${baseId}-${index + 1}`,
        source: sourceId,
        target: targetId,
        kind: 'flow' as const,
        weight: 1,
        lagMonths: 0,
        ...ports,
      }))
      .find((edge) => validateConnection(graph, edge, simulationSettings).valid);
    if (!candidate) {
      const first = getConnectionCandidates(source, target)[0];
      if (!first) {
        return 'No compatible ports are available.';
      }
      const validation = validateConnection(
        graph,
        { id: baseId, source: sourceId, target: targetId, kind: 'flow', weight: 1, lagMonths: 0, ...first },
        simulationSettings,
      );
      return validation.valid ? 'No compatible ports are available.' : validation.reason;
    }
    const selection: DocumentSelection = { graphPath: path, kind: 'edge', id: candidate.id, focus: true };
    if (!executeCommand({ type: 'add-edge', graphPath: path, edge: candidate }, selection)) {
      return 'The connection could not be created.';
    }
    setDocumentStatus(`Connected ${source.label || source.id} to ${target.label || target.id}. Undo is available.`);
    return undefined;
  };

  const handleImportText = (text: string) => {
    try {
      const candidate = parseGraphDocumentText(text);
      storageRef.current?.rememberLegacyImport(text);
      executeCommand({ type: 'replace-document', document: candidate }, null);
      setDocumentStatus('Opened project. The previous document is available through Undo.');
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : 'Import validation failed.';
    }
  };

  const handleUndo = () => storeRef.current.undo();
  const handleRedo = () => storeRef.current.redo();

  const handleHierarchySelectNode = (identity: ScopedNodeIdentity) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const rootGraph = graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document);
    const nextStack = buildViewStack(rootGraph, identity.graphPath);
    const targetGraph = getGraphAtPath(rootGraph, identity.graphPath);
    viewStackRef.current = nextStack;
    setViewStack(nextStack);
    setGraphSnapshot(rootGraph);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectedIdentity(undefined);
    const selection: DocumentSelection = {
      graphPath: identity.graphPath,
      kind: 'node',
      id: identity.nodeId,
      focus: isHierarchyFocusEnabled,
    };
    controller.projectGraph(
      targetGraph,
      identity.graphPath,
      selection,
      storeRef.current.getSnapshot().document.settings.simulation,
    );
    storeRef.current.setSelection(selection);
    scheduleFrame(() => {
      const didSelect = isHierarchyFocusEnabled ? focusNode(identity.nodeId) : selectNode(identity.nodeId);
      if (!didSelect) {
        return;
      }
      const nodeData = controller.cy.getElementById(identity.nodeId)?.data() as EconNodeData | undefined;
      setSelectedNode(nodeData ? { ...nodeData } : null);
      setSelectedIdentity(identity);
    });
    if (isCompactWorkspace) {
      setActiveCompactTab('inspector');
    }
  };

  const handleHierarchySelectEdge = (graphPath: readonly string[], edgeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      if (isCompactWorkspace) {
        setActiveCompactTab('graph');
      }
      return;
    }
    const rootGraph = graphDocumentToRuntimeGraph(storeRef.current.getSnapshot().document);
    const nextStack = buildViewStack(rootGraph, graphPath);
    const targetGraph = getGraphAtPath(rootGraph, graphPath);
    const edge = targetGraph.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) {
      return;
    }
    viewStackRef.current = nextStack;
    setViewStack(nextStack);
    const selection: DocumentSelection = { graphPath, kind: 'edge', id: edgeId, focus: true };
    controller.projectGraph(targetGraph, graphPath, selection, storeRef.current.getSnapshot().document.settings.simulation);
    storeRef.current.setSelection(selection);
    setSelectedNode(null);
    setSelectedIdentity(undefined);
    setSelectedEdge({ ...edge });
    if (isCompactWorkspace) {
      setActiveCompactTab('inspector');
    }
  };

  useEffect(() => {
    const handleHistoryKey = (event: KeyboardEvent) => {
      if (isCompactWorkspace && event.altKey && !event.ctrlKey && !event.metaKey) {
        const tab = event.key === '1' ? 'graph' : event.key === '2' ? 'hierarchy' : event.key === '3' ? 'inspector' : undefined;
        if (tab) {
          event.preventDefault();
          setActiveCompactTab(tab);
          scheduleFrame(() => document.getElementById(`compact-tab-${tab}`)?.focus());
          return;
        }
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', handleHistoryKey);
    return () => document.removeEventListener('keydown', handleHistoryKey);
  }, [isCompactWorkspace, scheduleFrame]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceState));
  }, [workspaceState]);

  useEffect(() => {
    scheduleGraphResize();
  }, [activeCompactTab, scheduleGraphResize, workspaceState.layout]);

  useEffect(() => {
    const handleViewportResize = () => {
      scheduleFrame(() => {
        const controller = controllerRef.current;
        if (!controller) {
          return;
        }
        controller.cy.resize();
        if (controller.cy.nodes().length > 0) {
          controller.cy.fit(undefined, isCompactWorkspace ? 24 : 40);
        }
      });
    };
    window.addEventListener('resize', handleViewportResize);
    handleViewportResize();
    return () => window.removeEventListener('resize', handleViewportResize);
  }, [isCompactWorkspace, scheduleFrame]);

  const handleWorkspaceLayoutChange = (nextLayout: Layout) => {
    setWorkspaceState((current) => {
      const repaired = repairWorkspaceState({
        panels: current.panels,
        layout: nextLayout.map((item) => cloneLayoutItem(item)),
      });
      return areLayoutsEqual(current.layout, repaired.layout) ? current : repaired;
    });
  };

  const handleAddPanel = (type: Exclude<PanelType, 'graph'>) => {
    setWorkspaceState((current) => {
      const panel = createPanelInstance(type, current.panels);
      const layout = [
        ...current.layout.map((item) => cloneLayoutItem(item)),
        getDefaultLayoutItem(panel, current.panels.length, getLayoutBottom(current.layout)),
      ];
      return repairWorkspaceState({
        panels: [...current.panels, panel],
        layout,
      });
    });
  };

  const handleClosePanel = (panelId: string) => {
    setWorkspaceState((current) => {
      const panel = current.panels.find((item) => item.id === panelId);
      if (!panel || panel.type === 'graph') {
        return current;
      }
      return repairWorkspaceState({
        panels: current.panels.filter((item) => item.id !== panelId),
        layout: current.layout.filter((item) => item.i !== panelId),
      });
    });
  };

  const handleResetWorkspace = () => {
    setWorkspaceState(getDefaultWorkspaceState());
  };

  const displayNodeScale = nodeScale / DEFAULT_NODE_SCALE;
  const activeGraphPath = currentGraphPath(viewStack);
  const activeGraph = getGraphAtPath(graphSnapshot, activeGraphPath);
  const breadcrumbs = buildBreadcrumbs(viewStack);
  const workspaceGridRows = Math.max(WORKSPACE_MIN_ROWS, getLayoutBottom(workspaceState.layout) + 6);
  const workspaceGridHeight =
    workspaceGridRows * WORKSPACE_ROW_HEIGHT +
    Math.max(0, workspaceGridRows - 1) * WORKSPACE_GRID_MARGIN[1] +
    WORKSPACE_GRID_PADDING[1] * 2;

  const renderPanelContent = (panel: PanelInstance, isCompactPanel = false) => {
    if (panel.type === 'graph') {
      return (
        <WorkspacePanel title={panel.title} bodyClassName="workspace-panel-body-graph">
          <div className="canvas-wrapper">
            <Toolbar
              onSave={handleExport}
              onOpenText={handleImportText}
              onAddNode={handleAddNode}
              onConnectNodes={handleConnectNodes}
              nodes={activeGraph.nodes}
              selectedNodeId={selectedNode?.id}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={storeSnapshot.canUndo}
              canRedo={storeSnapshot.canRedo}
              nodeScale={displayNodeScale}
              onNodeScaleChange={(value) =>
                executeCommand({ type: 'set-node-scale', nodeScale: value * DEFAULT_NODE_SCALE })
              }
              horizonMonths={simulationSettings.horizonMonths}
              onHorizonMonthsChange={(value) => {
                if (!Number.isInteger(value) || value < 1 || value > MAX_HORIZON_MONTHS) {
                  setDocumentStatus(`Horizon must be a whole number from 1 to ${MAX_HORIZON_MONTHS}.`);
                  return;
                }
                executeCommand({
                  type: 'set-simulation-settings',
                  settings: { ...simulationSettings, horizonMonths: value },
                });
              }}
              documentStatus={documentStatus}
              breadcrumbs={breadcrumbs}
              onNavigateBreadcrumb={(depth) => navigateToDepth(depth)}
              onBack={viewStack.length > 0 ? handleBack : undefined}
              theme={theme}
              onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            />
            <section className="graph-summary" aria-label="Graph error summary">
              <span>{activeGraph.nodes.length} nodes, {activeGraph.edges.length} connections.</span>
              <span className={diagnostics.length > 0 ? 'graph-summary-errors' : ''}>
                {diagnostics.length === 0 ? 'No compute errors.' : `${diagnostics.length} compute or validation error${diagnostics.length === 1 ? '' : 's'}. See the Inspector and graph structure for details.`}
              </span>
            </section>
            <div className="canvas-stage">
              <div
                className="canvas"
                ref={containerRef}
                tabIndex={0}
                role="region"
                aria-label="Visual graph canvas"
                aria-describedby="canvas-keyboard-help"
              />
              <p id="canvas-keyboard-help" className="sr-only">Use the visible Add and Connect controls for keyboard authoring. Press Shift and F10 on the canvas to open the add menu.</p>
              {activeGraph.nodes.length === 0 && (
                <div className="canvas-onboarding" role="note">
                  <strong>Start with Add.</strong>
                  <span>Select nodes in Graph structure, use Connect, then edit values in the Inspector.</span>
                </div>
              )}
            </div>
          </div>
        </WorkspacePanel>
      );
    }

    if (panel.type === 'hierarchy') {
      return (
        <WorkspacePanel title={panel.title} isClosable={!isCompactPanel} onClose={() => handleClosePanel(panel.id)}>
          <HierarchyPanel
            graph={graphSnapshot}
            selectedIdentity={selectedIdentity}
            selectedEdgeId={selectedEdge?.id}
            activeGraphPath={activeGraphPath}
            diagnostics={diagnostics}
            isFocusEnabled={isHierarchyFocusEnabled}
            onToggleFocus={() => setIsHierarchyFocusEnabled((prev) => !prev)}
            onSelectNode={handleHierarchySelectNode}
            onSelectEdge={handleHierarchySelectEdge}
          />
        </WorkspacePanel>
      );
    }

    return (
      <WorkspacePanel title={panel.title} isClosable={!isCompactPanel} onClose={() => handleClosePanel(panel.id)}>
        <InspectorPanel
          node={selectedNode}
          edge={selectedEdge}
          onChange={handleNodeChange}
          onChangeEdge={handleEdgeChange}
          getNodeById={getNodeById}
          onDeleteNode={handleNodeDelete}
          onDeleteEdge={handleEdgeDelete}
          graphPath={formatGraphPath(activeGraphPath)}
          diagnostics={diagnostics}
          selectionKey={selectedIdentity ? scopedNodeKey(selectedIdentity) : undefined}
        />
      </WorkspacePanel>
    );
  };

  const compactPanels: PanelInstance[] = [
    { id: 'compact-graph', type: 'graph', title: 'Graph' },
    { id: 'compact-hierarchy', type: 'hierarchy', title: 'Graph structure' },
    { id: 'compact-inspector', type: 'inspector', title: 'Inspector' },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>NodeSim authoring</h1>
        <span>Build and inspect a typed simulation graph.</span>
      </header>
      {isCompactWorkspace ? (
        <main className="compact-workspace">
          <div className="compact-tabs" role="tablist" aria-label="Authoring views">
            {compactPanels.map((panel) => (
              <button
                key={panel.type}
                id={`compact-tab-${panel.type}`}
                type="button"
                role="tab"
                aria-keyshortcuts={`Alt+${panel.type === 'graph' ? '1' : panel.type === 'hierarchy' ? '2' : '3'}`}
                aria-selected={activeCompactTab === panel.type}
                aria-controls={`compact-panel-${panel.type}`}
                tabIndex={activeCompactTab === panel.type ? 0 : -1}
                onClick={() => setActiveCompactTab(panel.type)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                    return;
                  }
                  event.preventDefault();
                  const index = compactPanels.findIndex((item) => item.type === activeCompactTab);
                  const delta = event.key === 'ArrowRight' ? 1 : -1;
                  const next = compactPanels[(index + delta + compactPanels.length) % compactPanels.length].type;
                  setActiveCompactTab(next);
                  scheduleFrame(() => document.getElementById(`compact-tab-${next}`)?.focus());
                }}
              >
                {panel.title}
              </button>
            ))}
          </div>
          <div className="compact-panel-stack">
            {compactPanels.map((panel) => (
              <div
                key={panel.type}
                id={`compact-panel-${panel.type}`}
                className="compact-tab-panel"
                role="tabpanel"
                aria-labelledby={`compact-tab-${panel.type}`}
                hidden={activeCompactTab !== panel.type}
              >
                {renderPanelContent(panel, true)}
              </div>
            ))}
          </div>
        </main>
      ) : (
        <main className="desktop-workspace">
          <div className="workspace-actions">
            <button type="button" onClick={() => handleAddPanel('hierarchy')}>Add graph structure</button>
            <button type="button" onClick={() => handleAddPanel('inspector')}>Add Inspector</button>
            <button type="button" className="workspace-action-secondary" onClick={handleResetWorkspace}>Reset layout</button>
          </div>
          <div className="workspace-grid-host" ref={setWorkspaceHostRef}>
            {isWorkspaceMounted && (
              <ReactGridLayout
                width={workspaceWidth}
                layout={workspaceState.layout}
                autoSize={false}
                style={{ height: workspaceGridHeight }}
                gridConfig={{ cols: WORKSPACE_GRID_COLS, rowHeight: WORKSPACE_ROW_HEIGHT, margin: WORKSPACE_GRID_MARGIN, containerPadding: WORKSPACE_GRID_PADDING }}
                dragConfig={{ enabled: true, handle: '.workspace-panel-header', cancel: 'button,input,select,textarea,label,a,.canvas,.react-resizable-handle', bounded: true }}
                resizeConfig={{ enabled: true, handles: WORKSPACE_RESIZE_HANDLES }}
                compactor={workspaceCompactor}
                onLayoutChange={handleWorkspaceLayoutChange}
                onResize={scheduleGraphResize}
                onResizeStop={scheduleGraphResize}
                onDragStop={scheduleGraphResize}
              >
                {workspaceState.panels.map((panel) => <div key={panel.id}>{renderPanelContent(panel)}</div>)}
              </ReactGridLayout>
            )}
          </div>
        </main>
      )}
    </div>
  );
};
