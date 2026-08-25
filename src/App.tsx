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
  SimulationSettingsV1,
} from './models/types';
import { createCytoscape } from './graph/createCytoscape';
import { validateConnection } from './engine/connectionValidation';
import { GraphDocumentStorage } from './document/documentStorage';
import {
  createGraphDocument,
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
  leaveGraphView,
  mergeViewStackToRoot,
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
import 'react-resizable/css/styles.css';
import './styles.css';

const DEFAULT_NODE_SCALE = 2;
const AUTOSAVE_DEBOUNCE_MS = 250;
const WORKSPACE_STORAGE_KEY = 'econgraph.workspace.v1';
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
  const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
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

export const App = () => {
  const [initialDocumentState] = useState<InitialDocumentState>(loadInitialDocument);
  const initialGraphRef = useRef<GraphData>(graphDocumentToRuntimeGraph(initialDocumentState.document));
  const storageRef = useRef<GraphDocumentStorage | null>(
    typeof window === 'undefined' ? null : new GraphDocumentStorage(window.localStorage),
  );
  const previousImportRef = useRef<GraphDocument | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const { width: workspaceWidth, containerRef: workspaceContainerRef, mounted: isWorkspaceMounted } = useContainerWidth();
  const [selectedNode, setSelectedNode] = useState<EconNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EconEdgeData | null>(null);
  const [nodeScale, setNodeScale] = useState(initialGraphRef.current.nodeScale ?? DEFAULT_NODE_SCALE);
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettingsV1>(
    initialDocumentState.document.settings.simulation,
  );
  const [documentStatus, setDocumentStatus] = useState(initialDocumentState.status);
  const [isDocumentDirty, setIsDocumentDirty] = useState(false);
  const [canUndoImport, setCanUndoImport] = useState(false);
  const [viewStack, setViewStack] = useState<GraphViewFrame[]>([]);
  const viewStackRef = useRef<GraphViewFrame[]>([]);
  const [selectedIdentity, setSelectedIdentity] = useState<ScopedNodeIdentity | undefined>();
  const [diagnostics, setDiagnostics] = useState<ComputeDiagnostic[]>([]);
  const [graphSnapshot, setGraphSnapshot] = useState<GraphData>(initialGraphRef.current);
  const [isHierarchyFocusEnabled, setIsHierarchyFocusEnabled] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(loadWorkspaceState);

  const scheduleGraphResize = useCallback(() => {
    window.requestAnimationFrame(() => {
      controllerRef.current?.cy.resize();
    });
  }, []);
  const setWorkspaceHostRef = useCallback(
    (element: HTMLDivElement | null) => {
      (workspaceContainerRef as MutableRefObject<HTMLDivElement | null>).current = element;
    },
    [workspaceContainerRef],
  );

  const refreshGraphSnapshot = () => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const currentGraph = controller.exportGraph();
    setGraphSnapshot(mergeViewStackToRoot(viewStackRef.current, currentGraph));
  };

  const handleAuthoredGraphChange = (currentGraph: GraphData) => {
    const rootGraph = mergeViewStackToRoot(viewStackRef.current, currentGraph);
    setGraphSnapshot(rootGraph);
    setIsDocumentDirty(true);
    setDocumentStatus('Unsaved changes');
  };

  const getCurrentRootGraph = () => {
    const currentGraph = controllerRef.current?.exportGraph() ?? graphSnapshot;
    return mergeViewStackToRoot(viewStackRef.current, currentGraph);
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
    controller.cy.animate(
      {
        center: { eles: node },
        zoom: Math.max(controller.cy.zoom(), 0.75),
      },
      {
        duration: 220,
      },
    );
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
    const parentGraph = controller.exportGraph();
    const parentPath = currentGraphPath(viewStackRef.current);
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
    controller.importGraph(node.custom.internalGraph, formatGraphPath(nextPath));
    const rootGraph = mergeViewStackToRoot(nextStack, node.custom.internalGraph);
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
          setSelectedIdentity(
            Object.freeze({ graphPath: currentGraphPath(viewStackRef.current), nodeId: node.id }),
          );
          setSelectedEdge(null);
          window.requestAnimationFrame(refreshGraphSnapshot);
        } else {
          setSelectedIdentity(undefined);
        }
      },
      onSelectEdge: (edge) => {
        setSelectedEdge(edge);
        if (edge) {
          setSelectedNode(null);
        }
      },
      onOpenCustomNode: handleOpenCustomNode,
      onGraphChange: handleAuthoredGraphChange,
      onConnectionRejected: (reason) => setDocumentStatus(`Connection rejected: ${reason}`),
      onDiagnostics: setDiagnostics,
    }, simulationSettings);
    scheduleGraphResize();
  }, [isWorkspaceMounted, scheduleGraphResize]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!isDocumentDirty) {
      return;
    }
    const timeout = window.setTimeout(() => {
      try {
        const document = createGraphDocument(graphSnapshot, simulationSettings);
        const revision = storageRef.current?.save(document);
        setIsDocumentDirty(false);
        setDocumentStatus(revision ? `Saved revision ${revision}` : 'Document validated');
      } catch (error) {
        setDocumentStatus(`Autosave blocked: ${error instanceof Error ? error.message : 'invalid document'}`);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [graphSnapshot, isDocumentDirty, simulationSettings]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    controller.setNodeScale(nodeScale);
  }, [nodeScale]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    controller.setSimulationSettings(simulationSettings);
    const selected = controller.cy.nodes(':selected').first();
    if (selected && !selected.empty()) {
      setSelectedNode({ ...(selected.data() as EconNodeData) });
    }
    refreshGraphSnapshot();
  }, [simulationSettings]);

  const handleNodeChange = (nodeId: string, data: Partial<EconNodeData>) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    controller.updateNodeData(nodeId, data);
    const updated = controller.cy.getElementById(nodeId)?.data() as EconNodeData | undefined;
    if (updated) {
      setSelectedNode({ ...updated });
    }
    refreshGraphSnapshot();
  };

  const handleNodeDelete = (nodeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    // Clear selection first to prevent any race conditions
    setSelectedNode(null);
    setSelectedEdge(null);
    controller.deleteNode(nodeId);
    window.requestAnimationFrame(refreshGraphSnapshot);
  };

  const handleEdgeDelete = (edgeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    setSelectedEdge(null);
    controller.deleteEdge(edgeId);
    window.requestAnimationFrame(refreshGraphSnapshot);
  };

  const navigateToDepth = (targetDepth: number, shouldFocusNode = true) => {
    const controller = controllerRef.current;
    if (!controller || targetDepth < 0 || targetDepth >= viewStackRef.current.length) {
      return;
    }
    let currentGraph = controller.exportGraph();
    let nextStack = [...viewStackRef.current];
    let nextSelection: ScopedNodeIdentity | undefined;
    while (nextStack.length > targetDepth) {
      const parent = leaveGraphView(nextStack, currentGraph);
      currentGraph = parent.graph;
      nextStack = parent.stack;
      nextSelection = parent.selection;
    }
    viewStackRef.current = nextStack;
    setViewStack(nextStack);
    const nextPath = currentGraphPath(nextStack);
    controller.importGraph(currentGraph, formatGraphPath(nextPath));
    const updatedCustom = nextSelection
      ? currentGraph.nodes.find((node) => node.id === nextSelection.nodeId) ?? null
      : null;
    setSelectedNode(updatedCustom ? { ...updatedCustom } : null);
    setSelectedEdge(null);
    setSelectedIdentity(nextSelection);
    setGraphSnapshot(mergeViewStackToRoot(nextStack, currentGraph));
    if (shouldFocusNode && nextSelection) {
      window.requestAnimationFrame(() => focusNode(nextSelection!.nodeId));
    }
  };

  const handleBack = () => navigateToDepth(viewStackRef.current.length - 1);

  const handleEdgeChange = (edgeId: string, data: Partial<EconEdgeData>) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const currentGraph = controller.exportGraph();
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
    controller.updateEdgeData(edgeId, data);
    const updated = controller.cy.getElementById(edgeId)?.data() as EconEdgeData | undefined;
    if (updated) {
      setSelectedEdge({ ...updated });
    }
    refreshGraphSnapshot();
  };

  const getNodeById = (nodeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      return null;
    }
    const data = controller.cy.getElementById(nodeId)?.data() as EconNodeData | undefined;
    return data ? { ...data } : null;
  };

  const applyImportedDocument = (document: GraphDocument) => {
    const data = graphDocumentToRuntimeGraph(document);
    viewStackRef.current = [];
    setViewStack([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectedIdentity(undefined);
    if (data.nodeScale !== undefined) {
      setNodeScale(data.nodeScale);
    }
    setSimulationSettings(document.settings.simulation);
    controllerRef.current?.setSimulationSettings(document.settings.simulation);
    controllerRef.current?.importGraph(data, '/root');
    setGraphSnapshot(data);
    setIsDocumentDirty(true);
    setDocumentStatus('Imported document validated; saving');
  };

  const handleExport = () => createGraphDocument(getCurrentRootGraph(), simulationSettings);

  const handleImportText = (text: string) => {
    try {
      const candidate = parseGraphDocumentText(text);
      previousImportRef.current = handleExport();
      storageRef.current?.rememberLegacyImport(text);
      applyImportedDocument(candidate);
      setCanUndoImport(true);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : 'Import validation failed.';
    }
  };

  const handleUndoImport = () => {
    const previous = previousImportRef.current;
    if (!previous) {
      return;
    }
    applyImportedDocument(previous);
    previousImportRef.current = null;
    setCanUndoImport(false);
    setDocumentStatus('Import undone; saving restored document');
  };

  const handleHierarchySelectNode = (identity: ScopedNodeIdentity) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const rootGraph = getCurrentRootGraph();
    const nextStack = buildViewStack(rootGraph, identity.graphPath);
    const targetGraph = getGraphAtPath(rootGraph, identity.graphPath);
    viewStackRef.current = nextStack;
    setViewStack(nextStack);
    setGraphSnapshot(rootGraph);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectedIdentity(undefined);
    controller.importGraph(targetGraph, formatGraphPath(identity.graphPath));
    window.requestAnimationFrame(() => {
      const didSelect = isHierarchyFocusEnabled ? focusNode(identity.nodeId) : selectNode(identity.nodeId);
      if (!didSelect) {
        return;
      }
      const nodeData = controller.cy.getElementById(identity.nodeId)?.data() as EconNodeData | undefined;
      setSelectedNode(nodeData ? { ...nodeData } : null);
      setSelectedIdentity(identity);
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceState));
  }, [workspaceState]);

  useEffect(() => {
    scheduleGraphResize();
  }, [scheduleGraphResize, workspaceState.layout]);

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
  const breadcrumbs = buildBreadcrumbs(viewStack);
  const workspaceGridRows = Math.max(WORKSPACE_MIN_ROWS, getLayoutBottom(workspaceState.layout) + 6);
  const workspaceGridHeight =
    workspaceGridRows * WORKSPACE_ROW_HEIGHT +
    Math.max(0, workspaceGridRows - 1) * WORKSPACE_GRID_MARGIN[1] +
    WORKSPACE_GRID_PADDING[1] * 2;

  const renderPanelContent = (panel: PanelInstance) => {
    if (panel.type === 'graph') {
      return (
        <WorkspacePanel title={panel.title} bodyClassName="workspace-panel-body-graph">
          <div className="canvas-wrapper">
            <Toolbar
              onExport={handleExport}
              onImportText={handleImportText}
              onUndoImport={canUndoImport ? handleUndoImport : undefined}
              nodeScale={displayNodeScale}
              onNodeScaleChange={(value) => setNodeScale(value * DEFAULT_NODE_SCALE)}
              horizonMonths={simulationSettings.horizonMonths}
              onHorizonMonthsChange={(value) => {
                if (!Number.isInteger(value) || value < 1 || value > MAX_HORIZON_MONTHS) {
                  setDocumentStatus(`Horizon must be a whole number from 1 to ${MAX_HORIZON_MONTHS}.`);
                  return;
                }
                setSimulationSettings((current) => ({ ...current, horizonMonths: value }));
                setIsDocumentDirty(true);
                setDocumentStatus('Unsaved changes');
              }}
              documentStatus={documentStatus}
              breadcrumbs={breadcrumbs}
              onNavigateBreadcrumb={(depth) => navigateToDepth(depth)}
              onBack={viewStack.length > 0 ? handleBack : undefined}
              theme={theme}
              onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            />
            <div className="canvas" ref={containerRef} />
          </div>
        </WorkspacePanel>
      );
    }

    if (panel.type === 'hierarchy') {
      return (
        <WorkspacePanel title={panel.title} isClosable onClose={() => handleClosePanel(panel.id)}>
          <HierarchyPanel
            graph={graphSnapshot}
            selectedIdentity={selectedIdentity}
            activeGraphPath={activeGraphPath}
            isFocusEnabled={isHierarchyFocusEnabled}
            onToggleFocus={() => setIsHierarchyFocusEnabled((prev) => !prev)}
            onSelectNode={handleHierarchySelectNode}
          />
        </WorkspacePanel>
      );
    }

    return (
      <WorkspacePanel title={panel.title} isClosable onClose={() => handleClosePanel(panel.id)}>
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

  return (
    <div className="app">
      <div className="workspace-actions">
        <button type="button" onClick={() => handleAddPanel('hierarchy')}>
          Add Hierarchy
        </button>
        <button type="button" onClick={() => handleAddPanel('inspector')}>
          Add Inspector
        </button>
        <button type="button" className="workspace-action-secondary" onClick={handleResetWorkspace}>
          Reset Layout
        </button>
      </div>
      <div className="workspace-grid-host" ref={setWorkspaceHostRef}>
        {isWorkspaceMounted && (
          <ReactGridLayout
            width={workspaceWidth}
            layout={workspaceState.layout}
            autoSize={false}
            style={{ height: workspaceGridHeight }}
            gridConfig={{
              cols: WORKSPACE_GRID_COLS,
              rowHeight: WORKSPACE_ROW_HEIGHT,
              margin: WORKSPACE_GRID_MARGIN,
              containerPadding: WORKSPACE_GRID_PADDING,
            }}
            dragConfig={{
              enabled: true,
              handle: '.workspace-panel-header',
              cancel: 'button,input,select,textarea,label,a,.canvas,.react-resizable-handle',
              bounded: true,
            }}
            resizeConfig={{ enabled: true, handles: WORKSPACE_RESIZE_HANDLES }}
            compactor={workspaceCompactor}
            onLayoutChange={handleWorkspaceLayoutChange}
            onResize={scheduleGraphResize}
            onResizeStop={scheduleGraphResize}
            onDragStop={scheduleGraphResize}
          >
            {workspaceState.panels.map((panel) => (
              <div key={panel.id}>{renderPanelContent(panel)}</div>
            ))}
          </ReactGridLayout>
        )}
      </div>
    </div>
  );
};
