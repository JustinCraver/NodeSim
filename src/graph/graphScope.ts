import type { EconNodeData, GraphData } from '../models/types';

export type GraphPath = readonly string[];

export type ScopedNodeIdentity = Readonly<{
  graphPath: GraphPath;
  nodeId: string;
}>;

export type GraphViewFrame = Readonly<{
  parentPath: GraphPath;
  parentGraph: GraphData;
  customNodeId: string;
  customNodeLabel: string;
}>;

export type GraphBreadcrumb = Readonly<{
  graphPath: GraphPath;
  label: string;
}>;

export const ROOT_GRAPH_PATH: GraphPath = Object.freeze([]);

export const appendGraphPath = (path: GraphPath, customNodeId: string): GraphPath =>
  Object.freeze([...path, customNodeId]);

export const formatGraphPath = (path: GraphPath) =>
  path.length === 0 ? '/root' : `/root/${path.join('/')}`;

export const graphPathKey = (path: GraphPath) => JSON.stringify(path);

export const scopedNodeKey = (identity: ScopedNodeIdentity) =>
  `${graphPathKey(identity.graphPath)}:${JSON.stringify(identity.nodeId)}`;

export const graphPathsEqual = (first: GraphPath, second: GraphPath) =>
  first.length === second.length && first.every((segment, index) => segment === second[index]);

const requireCustomNode = (graph: GraphData, customNodeId: string, path: GraphPath): EconNodeData => {
  const node = graph.nodes.find((candidate) => candidate.id === customNodeId);
  if (node?.kind !== 'custom' || !node.custom) {
    throw new Error(`${formatGraphPath(path)}: custom node ${customNodeId} does not exist`);
  }
  return node;
};

export const getGraphAtPath = (rootGraph: GraphData, path: GraphPath): GraphData => {
  let graph = rootGraph;
  let parentPath = ROOT_GRAPH_PATH;
  path.forEach((customNodeId) => {
    const node = requireCustomNode(graph, customNodeId, parentPath);
    graph = node.custom!.internalGraph;
    parentPath = appendGraphPath(parentPath, customNodeId);
  });
  return graph;
};

export const replaceGraphAtPath = (
  rootGraph: GraphData,
  path: GraphPath,
  replacement: GraphData,
): GraphData => {
  if (path.length === 0) {
    return replacement;
  }
  const [customNodeId, ...remaining] = path;
  requireCustomNode(rootGraph, customNodeId, ROOT_GRAPH_PATH);
  return {
    ...rootGraph,
    nodes: rootGraph.nodes.map((node) => {
      if (node.id !== customNodeId || node.kind !== 'custom' || !node.custom) {
        return node;
      }
      return {
        ...node,
        custom: {
          ...node.custom,
          internalGraph: replaceGraphAtPath(node.custom.internalGraph, remaining, replacement),
        },
      };
    }),
  };
};

export const currentGraphPath = (stack: readonly GraphViewFrame[]): GraphPath =>
  Object.freeze(stack.map((frame) => frame.customNodeId));

export const mergeViewStackToRoot = (
  stack: readonly GraphViewFrame[],
  currentGraph: GraphData,
): GraphData => {
  let childGraph = currentGraph;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const frame = stack[index];
    childGraph = replaceGraphAtPath(frame.parentGraph, [frame.customNodeId], childGraph);
  }
  return childGraph;
};

export const leaveGraphView = (
  stack: readonly GraphViewFrame[],
  currentGraph: GraphData,
): Readonly<{
  stack: GraphViewFrame[];
  graph: GraphData;
  selection: ScopedNodeIdentity;
}> => {
  if (stack.length === 0) {
    throw new Error('Cannot leave the root graph');
  }
  const frame = stack[stack.length - 1];
  return Object.freeze({
    stack: stack.slice(0, -1),
    graph: replaceGraphAtPath(frame.parentGraph, [frame.customNodeId], currentGraph),
    selection: Object.freeze({ graphPath: frame.parentPath, nodeId: frame.customNodeId }),
  });
};

export const buildViewStack = (rootGraph: GraphData, targetPath: GraphPath): GraphViewFrame[] => {
  const stack: GraphViewFrame[] = [];
  let graph = rootGraph;
  let parentPath = ROOT_GRAPH_PATH;
  targetPath.forEach((customNodeId) => {
    const node = requireCustomNode(graph, customNodeId, parentPath);
    stack.push(
      Object.freeze({
        parentPath,
        parentGraph: graph,
        customNodeId,
        customNodeLabel: node.label || node.id,
      }),
    );
    graph = node.custom!.internalGraph;
    parentPath = appendGraphPath(parentPath, customNodeId);
  });
  return stack;
};

export const buildBreadcrumbs = (stack: readonly GraphViewFrame[]): GraphBreadcrumb[] => [
  Object.freeze({ graphPath: ROOT_GRAPH_PATH, label: 'Main Graph' }),
  ...stack.map((frame, index) =>
    Object.freeze({
      graphPath: Object.freeze(stack.slice(0, index + 1).map((item) => item.customNodeId)),
      label: frame.customNodeLabel,
    }),
  ),
];
