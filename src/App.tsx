import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import ReactGridLayout, { noCompactor, useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import type { CustomNodeConfig, EconEdgeData, EconNodeData, GraphData } from './models/types';
import { createCytoscape } from './graph/createCytoscape';
import { computeGraph } from './engine/computeGraph';
import { HierarchyPanel } from './ui/HierarchyPanel';
import { InspectorPanel } from './ui/InspectorPanel';
import { Toolbar } from './ui/Toolbar';
import { WorkspacePanel } from './ui/WorkspacePanel';
import demoGraph from './demo/houseFund.json';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';

const DEFAULT_NODE_SCALE = 2;
const WORKSPACE_STORAGE_KEY = 'econgraph.workspace.v1';
const WORKSPACE_GRID_COLS = 12;
const WORKSPACE_ROW_HEIGHT = 36;

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
type CustomViewState = {
  parentGraph: GraphData;
  customNodeId: string;
};

const PANEL_TYPE_LABELS: Record<PanelType, string> = {
  graph: 'Graph',
  hierarchy: 'Hierarchy',
  inspector: 'Inspector',
};

const isPanelType = (value: unknown): value is PanelType =>
  value === 'graph' || value === 'hierarchy' || value === 'inspector';

const getDefaultLayoutItem = (panel: PanelInstance, index: number, y = 0): LayoutItem => {
  if (panel.type === 'graph') {
    return { i: panel.id, x: 3, y, w: 6, h: 15, minW: 4, minH: 8, resizeHandles: ['s', 'e', 'se'] };
  }
  if (panel.type === 'hierarchy') {
    return { i: panel.id, x: 0, y, w: 3, h: 15, minW: 2, minH: 7, resizeHandles: ['s', 'e', 'se'] };
  }
  return { i: panel.id, x: index === 2 ? 9 : 6, y, w: 3, h: 15, minW: 3, minH: 8, resizeHandles: ['s', 'e', 'se'] };
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

const cloneLayoutItem = (item: LayoutItem): LayoutItem => ({
  ...item,
  resizeHandles: item.resizeHandles ? [...item.resizeHandles] : ['s', 'e', 'se'],
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
      .map((item) => [item.i, cloneLayoutItem(item)]),
  );
  const repairedLayout: LayoutItem[] = [];

  panels.forEach((panel, index) => {
    const storedItem = layoutById.get(panel.id);
    repairedLayout.push(storedItem ?? getDefaultLayoutItem(panel, index, getLayoutBottom(repairedLayout)));
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

const getDefaultPortId = (ports: { id: string }[] | undefined) => ports?.[0]?.id;

const ensureCustomPorts = (custom: CustomNodeConfig) => {
  const internalGraph = {
    nodes: custom.internalGraph.nodes.map((node) => ({ ...node })),
    edges: custom.internalGraph.edges.map((edge) => ({ ...edge })),
    nodeScale: custom.internalGraph.nodeScale,
  };
  const inputBindings = { ...custom.inputBindings };
  const outputBindings = { ...custom.outputBindings };
  const nodeIds = new Set(internalGraph.nodes.map((node) => node.id));
  const nodeMap = new Map(internalGraph.nodes.map((node) => [node.id, node]));
  let changed = false;

  const createValueNode = (id: string, label: string) => {
    const node = {
      id,
      label,
      kind: 'value' as const,
      baseValue: 0,
    };
    internalGraph.nodes.push(node);
    nodeIds.add(id);
    nodeMap.set(id, node);
    changed = true;
  };

  const getAvailableId = (baseId: string) => {
    let candidate = baseId;
    let index = 1;
    while (nodeIds.has(candidate)) {
      candidate = `${baseId}-${index}`;
      index += 1;
    }
    return candidate;
  };

  custom.inputs.forEach((port, index) => {
    const label = port.label || `Input ${index + 1}`;
    const boundId = inputBindings[port.id];
    const boundNode = boundId ? nodeMap.get(boundId) : undefined;
    const boundValid = boundNode && (boundNode.kind === 'income' || boundNode.kind === 'value');

    if (boundValid) {
      return;
    }

    if (boundId && !boundNode) {
      createValueNode(boundId, label);
      inputBindings[port.id] = boundId;
      return;
    }

    const defaultId = `input-${port.id}`;
    if (defaultId !== boundId && nodeMap.has(defaultId)) {
      const defaultNode = nodeMap.get(defaultId);
      if (defaultNode && (defaultNode.kind === 'income' || defaultNode.kind === 'value')) {
        inputBindings[port.id] = defaultId;
        changed = true;
        return;
      }
    }

    const nextId = getAvailableId(defaultId);
    createValueNode(nextId, label);
    inputBindings[port.id] = nextId;
  });

  custom.outputs.forEach((port, index) => {
    const label = port.label || `Output ${index + 1}`;
    const boundId = outputBindings[port.id];
    const boundNode = boundId ? nodeMap.get(boundId) : undefined;

    if (boundNode) {
      return;
    }

    if (boundId && !boundNode) {
      createValueNode(boundId, label);
      outputBindings[port.id] = boundId;
      return;
    }

    const defaultId = `output-${port.id}`;
    if (defaultId !== boundId && nodeMap.has(defaultId)) {
      outputBindings[port.id] = defaultId;
      changed = true;
      return;
    }

    const nextId = getAvailableId(defaultId);
    createValueNode(nextId, label);
    outputBindings[port.id] = nextId;
  });

  if (!changed) {
    return custom;
  }

  return {
    ...custom,
    internalGraph,
    inputBindings,
    outputBindings,
  };
};

const computeCustomInputTotals = (graph: GraphData, customNodeId: string) => {
  const result = computeGraph(graph.nodes, graph.edges);
  const nodeMap = new Map(result.nodes.map((node) => [node.id, node]));
  const customOutputs = result.customOutputs ?? new Map<string, Map<string, number>>();
  const targetNode = nodeMap.get(customNodeId);
  const targetCustom = targetNode?.custom;

  if (!targetCustom) {
    return new Map<string, number>();
  }

  const inputPortIds = new Set(targetCustom.inputs.map((port) => port.id));
  const defaultInputPortId = getDefaultPortId(targetCustom.inputs);
  const totals = new Map<string, number>();

  const getEdgeValue = (edge: EconEdgeData) => {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) {
      return 0;
    }
    if (sourceNode.kind !== 'custom') {
      return sourceNode.computedValue ?? 0;
    }
    const portId = edge.sourcePort ?? getDefaultPortId(sourceNode.custom?.outputs);
    if (!portId) {
      return 0;
    }
    const outputs = customOutputs.get(sourceNode.id);
    if (outputs?.has(portId)) {
      return outputs.get(portId) ?? 0;
    }
    return sourceNode.computedValue ?? 0;
  };

  graph.edges.forEach((edge) => {
    if (edge.target !== customNodeId) {
      return;
    }
    const portId = edge.targetPort ?? defaultInputPortId;
    if (!portId || !inputPortIds.has(portId)) {
      return;
    }
    const value = getEdgeValue(edge);
    totals.set(portId, (totals.get(portId) ?? 0) + value);
  });

  return totals;
};

const syncCustomInputNodes = (custom: CustomNodeConfig, inputTotals: Map<string, number>) => {
  const boundValues = new Map<string, number>();

  custom.inputs.forEach((port) => {
    const boundId = custom.inputBindings[port.id];
    if (!boundId) {
      return;
    }
    boundValues.set(boundId, inputTotals.get(port.id) ?? 0);
  });

  if (boundValues.size === 0) {
    return custom;
  }

  let changed = false;
  const nextNodes = custom.internalGraph.nodes.map((node) => {
    const nextValue = boundValues.get(node.id);
    if (nextValue === undefined) {
      return node;
    }
    if (node.kind !== 'income' && node.kind !== 'value') {
      return node;
    }
    const nextNode = { ...node };
    if (node.baseValue !== nextValue) {
      nextNode.baseValue = nextValue;
      changed = true;
    }
    if (node.kind === 'income' && node.timeUnit !== 'per_month') {
      nextNode.timeUnit = 'per_month';
      changed = true;
    }
    return nextNode;
  });

  if (!changed) {
    return custom;
  }

  return {
    ...custom,
    internalGraph: {
      ...custom.internalGraph,
      nodes: nextNodes,
    },
  };
};

const mergeActiveCustomGraph = (parentGraph: GraphData, customNodeId: string, internalGraph: GraphData): GraphData => ({
  ...parentGraph,
  nodes: parentGraph.nodes.map((node) => {
    if (node.id !== customNodeId || !node.custom) {
      return node;
    }
    return {
      ...node,
      custom: {
        ...node.custom,
        internalGraph,
      },
    };
  }),
});

export const App = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const { width: workspaceWidth, containerRef: workspaceContainerRef, mounted: isWorkspaceMounted } = useContainerWidth();
  const [selectedNode, setSelectedNode] = useState<EconNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EconEdgeData | null>(null);
  const [nodeScale, setNodeScale] = useState((demoGraph as GraphData).nodeScale ?? DEFAULT_NODE_SCALE);
  const [customView, setCustomView] = useState<CustomViewState | null>(null);
  const customViewRef = useRef<CustomViewState | null>(null);
  const [graphSnapshot, setGraphSnapshot] = useState<GraphData>(demoGraph as GraphData);
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
    const viewState = customViewRef.current;
    setGraphSnapshot(
      viewState ? mergeActiveCustomGraph(viewState.parentGraph, viewState.customNodeId, currentGraph) : currentGraph,
    );
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
    if (customViewRef.current) {
      return false;
    }
    if (node.kind !== 'custom' || !node.custom) {
      return false;
    }
    const controller = controllerRef.current;
    if (!controller) {
      return false;
    }
    const ensuredCustom = ensureCustomPorts(node.custom);
    const parentGraph = controller.exportGraph();
    const updatedParent: GraphData =
      ensuredCustom === node.custom
        ? parentGraph
        : {
            ...parentGraph,
            nodes: parentGraph.nodes.map((item) =>
              item.id === node.id ? { ...item, custom: ensuredCustom } : item,
            ),
          };
    const inputTotals = computeCustomInputTotals(updatedParent, node.id);
    const syncedCustom = syncCustomInputNodes(ensuredCustom, inputTotals);
    const viewState = { parentGraph: updatedParent, customNodeId: node.id };
    customViewRef.current = viewState;
    setCustomView(viewState);
    controller.importGraph(syncedCustom.internalGraph);
    setGraphSnapshot(mergeActiveCustomGraph(updatedParent, node.id, syncedCustom.internalGraph));
    setSelectedNode(null);
    setSelectedEdge(null);
    return true;
  };

  const handleOpenCustomNode = (node: EconNodeData) => {
    openCustomNode(node);
  };

  useEffect(() => {
    if (!containerRef.current || controllerRef.current) {
      return;
    }
    controllerRef.current = createCytoscape(containerRef.current, demoGraph as GraphData, {
      onSelectNode: (node) => {
        setSelectedNode(node);
        if (node) {
          setSelectedEdge(null);
          window.requestAnimationFrame(refreshGraphSnapshot);
        }
      },
      onSelectEdge: (edge) => {
        setSelectedEdge(edge);
        if (edge) {
          setSelectedNode(null);
        }
      },
      onOpenCustomNode: handleOpenCustomNode,
    });
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
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    controller.setNodeScale(nodeScale);
  }, [nodeScale]);

  const handleNodeChange = (nodeId: string, data: Partial<EconNodeData>) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    const nextData = data.custom ? { ...data, custom: ensureCustomPorts(data.custom) } : data;
    controller.updateNodeData(nodeId, nextData);
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

  const handleExitCustomView = (shouldFocusNode = true) => {
    const controller = controllerRef.current;
    const viewState = customViewRef.current;
    if (!controller || !viewState) {
      return;
    }
    const internalGraph = controller.exportGraph();
    const updatedParent: GraphData = {
      ...viewState.parentGraph,
      nodes: viewState.parentGraph.nodes.map((node) => {
        if (node.id !== viewState.customNodeId || !node.custom) {
          return node;
        }
        const syncedCustom = ensureCustomPorts({ ...node.custom, internalGraph });
        return {
          ...node,
          custom: syncedCustom,
        };
      }),
    };
    controller.importGraph(updatedParent);
    const updatedCustom = updatedParent.nodes.find((node) => node.id === viewState.customNodeId) ?? null;
    setSelectedNode(updatedCustom ? { ...updatedCustom } : null);
    setSelectedEdge(null);
    customViewRef.current = null;
    setCustomView(null);
    setGraphSnapshot(updatedParent);
    if (shouldFocusNode) {
      window.requestAnimationFrame(() => focusNode(viewState.customNodeId));
    }
  };

  const handleEdgeChange = (edgeId: string, data: Partial<EconEdgeData>) => {
    const controller = controllerRef.current;
    if (!controller) {
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

  const handleExport = () => controllerRef.current?.exportGraph() ?? (demoGraph as GraphData);

  const handleImport = (data: GraphData) => {
    customViewRef.current = null;
    setCustomView(null);
    setSelectedNode(null);
    setSelectedEdge(null);
    if (data.nodeScale !== undefined) {
      setNodeScale(data.nodeScale);
    }
    controllerRef.current?.importGraph(data);
    setGraphSnapshot(data);
  };

  const handleHierarchySelectNode = (nodeId: string) => {
    const viewState = customViewRef.current;
    if (viewState) {
      handleExitCustomView(isHierarchyFocusEnabled);
      window.requestAnimationFrame(() => {
        if (isHierarchyFocusEnabled) {
          focusNode(nodeId);
          return;
        }
        selectNode(nodeId);
      });
      return;
    }
    if (isHierarchyFocusEnabled) {
      focusNode(nodeId);
      return;
    }
    selectNode(nodeId);
  };

  const handleHierarchySelectInternalNode = (customNodeId: string, nodeId: string) => {
    const viewState = customViewRef.current;
    if (viewState?.customNodeId === customNodeId) {
      if (isHierarchyFocusEnabled) {
        focusNode(nodeId);
        return;
      }
      selectNode(nodeId);
      return;
    }
    if (viewState) {
      handleExitCustomView(isHierarchyFocusEnabled);
    }
    window.requestAnimationFrame(() => {
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }
      const customNodeData = controller.cy.getElementById(customNodeId)?.data() as EconNodeData | undefined;
      if (!customNodeData || !openCustomNode({ ...customNodeData })) {
        return;
      }
      window.requestAnimationFrame(() => {
        if (isHierarchyFocusEnabled) {
          focusNode(nodeId);
          return;
        }
        selectNode(nodeId);
      });
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

  const renderPanelContent = (panel: PanelInstance) => {
    if (panel.type === 'graph') {
      return (
        <WorkspacePanel title={panel.title} bodyClassName="workspace-panel-body-graph">
          <div className="canvas-wrapper">
            <Toolbar
              onExport={handleExport}
              onImport={handleImport}
              nodeScale={displayNodeScale}
              onNodeScaleChange={(value) => setNodeScale(value * DEFAULT_NODE_SCALE)}
              isCustomView={Boolean(customView)}
              onExitCustomView={customView ? handleExitCustomView : undefined}
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
            selectedNodeId={selectedNode?.id}
            activeCustomNodeId={customView?.customNodeId}
            isFocusEnabled={isHierarchyFocusEnabled}
            onToggleFocus={() => setIsHierarchyFocusEnabled((prev) => !prev)}
            onSelectNode={handleHierarchySelectNode}
            onSelectInternalNode={handleHierarchySelectInternalNode}
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
            gridConfig={{
              cols: WORKSPACE_GRID_COLS,
              rowHeight: WORKSPACE_ROW_HEIGHT,
              margin: [12, 12],
              containerPadding: [12, 12],
            }}
            dragConfig={{
              handle: '.workspace-panel-header',
              cancel: 'button,input,select,textarea,label,a,.canvas,.react-resizable-handle',
              bounded: true,
            }}
            resizeConfig={{ handles: ['s', 'e', 'se'] }}
            compactor={noCompactor}
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
