import {
  createGraphDocument,
  graphDocumentToRuntimeGraph,
  migrateGraphDocument,
} from './graphDocument';
import { getGraphAtPath, replaceGraphAtPath, type GraphPath } from '../graph/graphScope';
import type {
  CustomNodeConfig,
  EconEdgeData,
  EconNodeData,
  GraphData,
  GraphDocument,
  SimulationSettingsV1,
} from '../models/types';

export type DocumentSelection = Readonly<{
  graphPath: GraphPath;
  kind: 'node' | 'edge';
  id: string;
  focus: boolean;
}>;

type GraphCommandBase = Readonly<{ graphPath: GraphPath }>;

export type DocumentCommand =
  | (GraphCommandBase & Readonly<{ type: 'add-node'; node: EconNodeData }>)
  | (GraphCommandBase & Readonly<{ type: 'update-node'; nodeId: string; changes: Partial<EconNodeData> }>)
  | (GraphCommandBase & Readonly<{ type: 'change-node-type'; nodeId: string; changes: Partial<EconNodeData> }>)
  | (GraphCommandBase & Readonly<{ type: 'move-node'; nodeId: string; position: { x: number; y: number } }>)
  | (GraphCommandBase & Readonly<{ type: 'delete-node'; nodeId: string }>)
  | (GraphCommandBase & Readonly<{ type: 'add-edge'; edge: EconEdgeData }>)
  | (GraphCommandBase & Readonly<{ type: 'update-edge'; edgeId: string; changes: Partial<EconEdgeData> }>)
  | (GraphCommandBase & Readonly<{ type: 'delete-edge'; edgeId: string }>)
  | (GraphCommandBase &
      Readonly<{ type: 'update-custom-ports'; nodeId: string; custom: CustomNodeConfig }>)
  | Readonly<{ type: 'replace-nested-graph'; graphPath: GraphPath; graph: GraphData }>
  | Readonly<{ type: 'replace-document'; document: GraphDocument }>
  | Readonly<{ type: 'set-node-scale'; nodeScale: number }>
  | Readonly<{ type: 'set-simulation-settings'; settings: SimulationSettingsV1 }>;

export type DocumentStoreSnapshot = Readonly<{
  document: GraphDocument;
  revision: number;
  selection?: DocumentSelection;
  canUndo: boolean;
  canRedo: boolean;
  lastCommand?: DocumentCommand['type'];
}>;

type HistoryEntry = Readonly<{
  command: DocumentCommand;
  before: GraphDocument;
  after: GraphDocument;
  beforeSelection?: DocumentSelection;
  afterSelection?: DocumentSelection;
}>;

type StoreListener = (snapshot: DocumentStoreSnapshot) => void;

const HISTORY_LIMIT = 100;

const cloneSelection = (selection: DocumentSelection | undefined): DocumentSelection | undefined =>
  selection
    ? Object.freeze({
        ...selection,
        graphPath: Object.freeze([...selection.graphPath]),
      })
    : undefined;

const updateGraphAtPath = (
  document: GraphDocument,
  path: GraphPath,
  update: (graph: GraphData) => GraphData,
): GraphDocument => {
  const root = graphDocumentToRuntimeGraph(document);
  const current = getGraphAtPath(root, path);
  const nextRoot = replaceGraphAtPath(root, path, update(current));
  return createGraphDocument(nextRoot, document.settings.simulation);
};

const requireNode = (graph: GraphData, nodeId: string) => {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} does not exist`);
  }
  return node;
};

const applyGraphCommand = (document: GraphDocument, command: DocumentCommand): GraphDocument => {
  switch (command.type) {
    case 'replace-document':
      return migrateGraphDocument(command.document);
    case 'set-simulation-settings':
      return createGraphDocument(graphDocumentToRuntimeGraph(document), command.settings);
    case 'set-node-scale':
      return updateGraphAtPath(document, [], (graph) => ({ ...graph, nodeScale: command.nodeScale }));
    case 'replace-nested-graph':
      return updateGraphAtPath(document, command.graphPath, () => structuredClone(command.graph));
    case 'add-node':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        if (graph.nodes.some((node) => node.id === command.node.id)) {
          throw new Error(`Node ${command.node.id} already exists`);
        }
        return { ...graph, nodes: [...graph.nodes, structuredClone(command.node)] };
      });
    case 'update-node':
    case 'change-node-type':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        requireNode(graph, command.nodeId);
        return {
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === command.nodeId ? { ...node, ...structuredClone(command.changes) } : node,
          ),
        };
      });
    case 'move-node':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        requireNode(graph, command.nodeId);
        return {
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === command.nodeId ? { ...node, position: { ...command.position } } : node,
          ),
        };
      });
    case 'delete-node':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        requireNode(graph, command.nodeId);
        return {
          ...graph,
          nodes: graph.nodes.filter((node) => node.id !== command.nodeId),
          edges: graph.edges.filter(
            (edge) => edge.source !== command.nodeId && edge.target !== command.nodeId,
          ),
        };
      });
    case 'add-edge':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        if (graph.edges.some((edge) => edge.id === command.edge.id)) {
          throw new Error(`Edge ${command.edge.id} already exists`);
        }
        return { ...graph, edges: [...graph.edges, { ...command.edge }] };
      });
    case 'update-edge':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        if (!graph.edges.some((edge) => edge.id === command.edgeId)) {
          throw new Error(`Edge ${command.edgeId} does not exist`);
        }
        return {
          ...graph,
          edges: graph.edges.map((edge) =>
            edge.id === command.edgeId ? { ...edge, ...command.changes } : edge,
          ),
        };
      });
    case 'delete-edge':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        if (!graph.edges.some((edge) => edge.id === command.edgeId)) {
          throw new Error(`Edge ${command.edgeId} does not exist`);
        }
        return { ...graph, edges: graph.edges.filter((edge) => edge.id !== command.edgeId) };
      });
    case 'update-custom-ports':
      return updateGraphAtPath(document, command.graphPath, (graph) => {
        const node = requireNode(graph, command.nodeId);
        if (node.kind !== 'custom' || !node.custom) {
          throw new Error(`Node ${command.nodeId} is not a custom node`);
        }
        const inputIds = new Set(command.custom.inputs.map((port) => port.id));
        const outputIds = new Set(command.custom.outputs.map((port) => port.id));
        return {
          ...graph,
          nodes: graph.nodes.map((candidate) =>
            candidate.id === command.nodeId
              ? {
                  ...candidate,
                  custom: {
                    ...structuredClone(command.custom),
                    internalGraph: node.custom!.internalGraph,
                  },
                }
              : candidate,
          ),
          edges: graph.edges.filter(
            (edge) =>
              !(edge.target === command.nodeId && edge.targetPort && !inputIds.has(edge.targetPort)) &&
              !(edge.source === command.nodeId && edge.sourcePort && !outputIds.has(edge.sourcePort)),
          ),
        };
      });
  }
};

export class GraphDocumentStore {
  private document: GraphDocument;
  private revision = 1;
  private selection?: DocumentSelection;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<StoreListener>();
  private lastCommand?: DocumentCommand['type'];

  constructor(initialDocument: GraphDocument) {
    this.document = migrateGraphDocument(initialDocument);
  }

  getSnapshot = (): DocumentStoreSnapshot =>
    Object.freeze({
      document: this.document,
      revision: this.revision,
      selection: cloneSelection(this.selection),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      lastCommand: this.lastCommand,
    });

  subscribe(listener: StoreListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSelection(selection: DocumentSelection | undefined) {
    this.selection = cloneSelection(selection);
    this.emit();
  }

  execute(command: DocumentCommand, selectionAfter?: DocumentSelection) {
    const before = this.document;
    const beforeSelection = cloneSelection(this.selection);
    const after = applyGraphCommand(before, command);
    const afterSelection = cloneSelection(arguments.length >= 2 ? selectionAfter : this.selection);
    this.undoStack.push({ command, before, after, beforeSelection, afterSelection });
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.splice(0, this.undoStack.length - HISTORY_LIMIT);
    }
    this.redoStack = [];
    this.document = after;
    this.selection = afterSelection;
    this.revision += 1;
    this.lastCommand = command.type;
    this.emit();
    return this.getSnapshot();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) {
      return false;
    }
    this.redoStack.push(entry);
    this.document = entry.before;
    this.selection = cloneSelection(entry.beforeSelection);
    this.revision += 1;
    this.lastCommand = entry.command.type;
    this.emit();
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) {
      return false;
    }
    this.undoStack.push(entry);
    this.document = entry.after;
    this.selection = cloneSelection(entry.afterSelection);
    this.revision += 1;
    this.lastCommand = entry.command.type;
    this.emit();
    return true;
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
