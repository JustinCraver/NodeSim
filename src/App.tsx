import { useEffect, useRef, useState } from 'react';
import type { EconNodeData, GraphData } from './models/types';
import { createCytoscape } from './graph/createCytoscape';
import { InspectorPanel } from './ui/InspectorPanel';
import { Toolbar } from './ui/Toolbar';
import demoGraph from './demo/coffeeToHouse.json';
import './styles.css';

const COFFEE_NODE_ID = 'coffee';
const COFFEE_DEFAULT_VALUE = 5;

type GraphController = ReturnType<typeof createCytoscape>;

export const App = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GraphController | null>(null);
  const [selectedNode, setSelectedNode] = useState<EconNodeData | null>(null);
  const [disableCoffee, setDisableCoffee] = useState(false);

  useEffect(() => {
    if (!containerRef.current || controllerRef.current) {
      return;
    }
    controllerRef.current = createCytoscape(containerRef.current, demoGraph as GraphData, {
      onSelectNode: setSelectedNode,
    });
  }, []);

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

  const handleExport = () => controllerRef.current?.exportGraph() ?? (demoGraph as GraphData);

  const handleImport = (data: GraphData) => {
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
        />
        <div className="canvas" ref={containerRef} />
      </div>
      <InspectorPanel node={selectedNode} onChange={handleNodeChange} />
    </div>
  );
};
