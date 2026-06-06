import { useEffect, useRef, useState } from 'react';
import type { CustomNodeConfig, EconEdgeData, EconNodeData, GraphData } from './models/types';
import { createCytoscape } from './graph/createCytoscape';
import { computeGraph } from './engine/computeGraph';
import { InspectorPanel } from './ui/InspectorPanel';
import { Toolbar } from './ui/Toolbar';
import demoGraph from './demo/houseFund.json';
import './styles.css';

type GraphController = ReturnType<typeof createCytoscape>;
type CustomViewState = {
  parentGraph: GraphData;
  customNodeId: string;
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

export const App = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [selectedNode, setSelectedNode] = useState<EconNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EconEdgeData | null>(null);
  const [nodeScale, setNodeScale] = useState(1);
  const [customView, setCustomView] = useState<CustomViewState | null>(null);
  const customViewRef = useRef<CustomViewState | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  const handleOpenCustomNode = (node: EconNodeData) => {
    if (customViewRef.current) {
      return;
    }
    if (node.kind !== 'custom' || !node.custom) {
      return;
    }
    const controller = controllerRef.current;
    if (!controller) {
      return;
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
    setSelectedNode(null);
    setSelectedEdge(null);
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
  }, []);

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
  };

  const handleEdgeDelete = (edgeId: string) => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    setSelectedEdge(null);
    controller.deleteEdge(edgeId);
  };

  const handleExitCustomView = () => {
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
    if (data.nodeScale !== undefined) {
      setNodeScale(data.nodeScale);
    }
    controllerRef.current?.importGraph(data);
  };

  return (
    <div className="app">
      <div className="canvas-wrapper">
        <Toolbar
          onExport={handleExport}
          onImport={handleImport}
          nodeScale={nodeScale}
          onNodeScaleChange={setNodeScale}
          isCustomView={Boolean(customView)}
          onExitCustomView={customView ? handleExitCustomView : undefined}
          theme={theme}
          onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        />
        <div className="canvas" ref={containerRef} />
      </div>
      <InspectorPanel
        node={selectedNode}
        edge={selectedEdge}
        onChange={handleNodeChange}
        onChangeEdge={handleEdgeChange}
        getNodeById={getNodeById}
        onDeleteNode={handleNodeDelete}
        onDeleteEdge={handleEdgeDelete}
      />
    </div>
  );
};
