import { useEffect, useRef, useState } from 'react';
import type { CustomNodeConfig, EconEdgeData, EconNodeData, GraphData } from './models/types';
import { createCytoscape } from './graph/createCytoscape';
import { InspectorPanel } from './ui/InspectorPanel';
import { Toolbar } from './ui/Toolbar';
import demoGraph from './demo/coffeeToHouse.json';
import './styles.css';

const COFFEE_NODE_ID = 'coffee';
const COFFEE_DEFAULT_VALUE = 5;

type GraphController = ReturnType<typeof createCytoscape>;
type CustomViewState = {
  parentGraph: GraphData;
  customNodeId: string;
};

const ensureCustomInputs = (custom: CustomNodeConfig) => {
  const internalGraph = {
    nodes: custom.internalGraph.nodes.map((node) => ({ ...node })),
    edges: custom.internalGraph.edges.map((edge) => ({ ...edge })),
  };
  const inputBindings = { ...custom.inputBindings };
  const nodeIds = new Set(internalGraph.nodes.map((node) => node.id));
  let changed = false;

  custom.inputs.forEach((port, index) => {
    let boundId = inputBindings[port.id];
    if (!boundId) {
      boundId = `input-${port.id}`;
      inputBindings[port.id] = boundId;
      changed = true;
    }
    if (!nodeIds.has(boundId)) {
      internalGraph.nodes.push({
        id: boundId,
        label: port.label || `Input ${index + 1}`,
        kind: 'value',
        baseValue: 0,
      });
      nodeIds.add(boundId);
      changed = true;
    }
  });

  if (!changed) {
    return custom;
  }

  return {
    ...custom,
    internalGraph,
    inputBindings,
  };
};

export const App = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [selectedNode, setSelectedNode] = useState<EconNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<EconEdgeData | null>(null);
  const [disableCoffee, setDisableCoffee] = useState(false);
  const [nodeScale, setNodeScale] = useState(1);
  const [customView, setCustomView] = useState<CustomViewState | null>(null);
  const customViewRef = useRef<CustomViewState | null>(null);

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
    const ensuredCustom = ensureCustomInputs(node.custom);
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
    const viewState = { parentGraph: updatedParent, customNodeId: node.id };
    customViewRef.current = viewState;
    setCustomView(viewState);
    controller.importGraph(ensuredCustom.internalGraph);
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
    controller.updateNodeData(nodeId, data);
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
        return {
          ...node,
          custom: {
            ...node.custom,
            internalGraph,
          },
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

  const handleToggleCoffee = (value: boolean) => {
    setDisableCoffee(value);
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    controller.updateNodeData(COFFEE_NODE_ID, {
      baseValue: value ? 0 : COFFEE_DEFAULT_VALUE,
    });
  };

  return (
    <div className="app">
      <div className="canvas-wrapper">
        <Toolbar
          onExport={handleExport}
          onImport={handleImport}
          disableCoffee={disableCoffee}
          onToggleCoffee={handleToggleCoffee}
          nodeScale={nodeScale}
          onNodeScaleChange={setNodeScale}
          isCustomView={Boolean(customView)}
          onExitCustomView={customView ? handleExitCustomView : undefined}
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
