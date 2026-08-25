import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { MAX_HORIZON_MONTHS, MAX_IMPORT_BYTES } from '../document/graphDocument';
import type { GraphBreadcrumb } from '../graph/graphScope';
import type { EconNodeData, GraphDocument, NodeKind } from '../models/types';
import { NumericDraftField } from './NumericDraftField';

const NODE_OPTIONS: Array<{ kind: NodeKind; label: string; group: string }> = [
  { kind: 'value', label: 'Value', group: 'Basic math' },
  { kind: 'add', label: 'Add', group: 'Basic math' },
  { kind: 'subtract', label: 'Subtract', group: 'Basic math' },
  { kind: 'multiply', label: 'Multiply', group: 'Basic math' },
  { kind: 'divide', label: 'Divide', group: 'Basic math' },
  { kind: 'income', label: 'Income', group: 'Economy' },
  { kind: 'expense', label: 'Expense', group: 'Economy' },
  { kind: 'calc', label: 'Formula', group: 'Economy' },
  { kind: 'asset', label: 'Asset', group: 'Economy' },
  { kind: 'output', label: 'Output target', group: 'Economy' },
  { kind: 'custom', label: 'Custom graph', group: 'Economy' },
  { kind: 'text', label: 'Text note', group: 'Notes' },
];

type ToolbarProps = {
  onSave: () => GraphDocument;
  onOpenText: (text: string) => string | undefined;
  onAddNode: (kind: NodeKind) => void;
  onConnectNodes: (sourceId: string, targetId: string) => string | undefined;
  nodes: readonly EconNodeData[];
  selectedNodeId?: string;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  nodeScale: number;
  onNodeScaleChange: (value: number) => void;
  horizonMonths: number;
  onHorizonMonthsChange: (value: number) => void;
  documentStatus: string;
  breadcrumbs: readonly GraphBreadcrumb[];
  onNavigateBreadcrumb: (depth: number) => void;
  onBack?: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
};

export const Toolbar = ({
  onSave,
  onOpenText,
  onAddNode,
  onConnectNodes,
  nodes,
  selectedNodeId,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  nodeScale,
  onNodeScaleChange,
  horizonMonths,
  onHorizonMonthsChange,
  documentStatus,
  breadcrumbs,
  onNavigateBreadcrumb,
  onBack,
  theme,
  onToggleTheme,
}: ToolbarProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const connectSourceRef = useRef<HTMLSelectElement>(null);
  const [importError, setImportError] = useState<string>();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [connectError, setConnectError] = useState<string>();
  const [actionStatus, setActionStatus] = useState<string>();

  useEffect(() => {
    if (isAddOpen) {
      addMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
  }, [isAddOpen]);

  useEffect(() => {
    if (!isConnectOpen) {
      return;
    }
    const preferredSource = selectedNodeId && nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : nodes[0]?.id ?? '';
    setSourceId(preferredSource);
    setTargetId(nodes.find((node) => node.id !== preferredSource)?.id ?? '');
    setConnectError(undefined);
    window.requestAnimationFrame(() => connectSourceRef.current?.focus());
  }, [isConnectOpen, nodes, selectedNodeId]);

  useEffect(() => {
    setActionStatus(undefined);
  }, [documentStatus]);

  const handleSave = () => {
    const data = onSave();
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'econgraph-v1.json';
    link.click();
    URL.revokeObjectURL(url);
    setActionStatus('Project save started. Check browser downloads.');
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`Open failed: file exceeds the ${MAX_IMPORT_BYTES}-byte limit.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setImportError('Open failed: the selected file could not be read.');
    reader.onload = () => {
      const text = reader.result?.toString();
      if (!text) {
        setImportError('Open failed: the selected file is empty.');
        return;
      }
      setImportError(onOpenText(text));
    };
    reader.readAsText(file);
  };

  const closeAddMenu = (restoreFocus = true) => {
    setIsAddOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => addButtonRef.current?.focus());
    }
  };

  const handleAddMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(addMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAddMenu();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + delta + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
      event.preventDefault();
      items[current].click();
    }
  };

  const closeConnect = () => {
    setIsConnectOpen(false);
    window.requestAnimationFrame(() => connectButtonRef.current?.focus());
  };

  const handleConnect = () => {
    const error = onConnectNodes(sourceId, targetId);
    setConnectError(error);
    if (!error) {
      closeConnect();
    }
  };

  const visibleStatus = importError ?? actionStatus ?? documentStatus;

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'a') {
        event.preventDefault();
        setIsConnectOpen(false);
        setIsAddOpen(true);
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'c') {
        event.preventDefault();
        setIsAddOpen(false);
        if (nodes.length >= 2) setIsConnectOpen(true);
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'o') {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 's') {
        event.preventDefault();
        handleSave();
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'u' && canUndo) {
        event.preventDefault();
        onUndo();
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && key === 'r' && canRedo) {
        event.preventDefault();
        onRedo();
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'o') {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 's') {
        event.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [canRedo, canUndo, nodes.length, onRedo, onSave, onUndo]);

  return (
    <div className="toolbar" aria-label="Graph authoring toolbar">
      <div className="toolbar-primary-actions">
        <div className="toolbar-popover-anchor">
          <button ref={addButtonRef} type="button" aria-haspopup="menu" aria-expanded={isAddOpen} aria-keyshortcuts="Alt+A" title="Add node (Alt+A)" onClick={() => {
            setIsConnectOpen(false);
            setIsAddOpen((open) => !open);
          }}>
            Add
          </button>
          {isAddOpen && (
            <div ref={addMenuRef} className="toolbar-menu" role="menu" aria-label="Add node" onKeyDown={handleAddMenuKeyDown}>
              {NODE_OPTIONS.map((option, index) => {
                const showGroup = index === 0 || NODE_OPTIONS[index - 1].group !== option.group;
                return (
                  <div key={option.kind} role="presentation">
                    {showGroup && <div className="toolbar-menu-heading">{option.group}</div>}
                    <button type="button" role="menuitem" onClick={() => {
                      onAddNode(option.kind);
                      closeAddMenu();
                    }}>
                      {option.label}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="toolbar-popover-anchor">
          <button ref={connectButtonRef} type="button" aria-haspopup="dialog" aria-expanded={isConnectOpen} aria-keyshortcuts="Alt+C" title="Connect nodes (Alt+C)" disabled={nodes.length < 2} onClick={() => {
            setIsAddOpen(false);
            setIsConnectOpen((open) => !open);
          }}>
            Connect
          </button>
          {isConnectOpen && (
            <div className="connect-popover" role="dialog" aria-modal="false" aria-labelledby="connect-title" onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeConnect();
              } else if (event.altKey && event.key === 'Enter') {
                event.preventDefault();
                handleConnect();
              }
            }}>
              <h3 id="connect-title">Connect nodes</h3>
              <label>
                <span>From</span>
                <select ref={connectSourceRef} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                  {nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}
                </select>
              </label>
              <label>
                <span>To</span>
                <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  {nodes.map((node) => <option key={node.id} value={node.id}>{node.label || node.id}</option>)}
                </select>
              </label>
              {connectError && <p id="connect-error" className="field-error">{connectError}</p>}
              <div className="connect-actions">
                <button type="button" aria-keyshortcuts="Alt+Enter" title="Create connection (Alt+Enter)" onClick={handleConnect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleConnect(); } }} aria-describedby={connectError ? 'connect-error' : undefined}>Create connection</button>
                <button type="button" className="secondary-button" onClick={closeConnect}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        <label className="toolbar-file-button" title="Open project (Alt+O or Ctrl+O)">
          <span aria-hidden="true">Open</span>
          <input ref={fileInputRef} type="file" accept="application/json,.json" aria-label="Open" aria-keyshortcuts="Alt+O Control+O Meta+O" onChange={handleFileChange} />
        </label>
        <button type="button" aria-keyshortcuts="Alt+S Control+S Meta+S" title="Save project (Alt+S or Ctrl+S)" onClick={handleSave} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleSave(); } }}>Save</button>
        <button type="button" aria-keyshortcuts="Alt+U Control+Z Meta+Z" title="Undo (Alt+U or Ctrl+Z)" onClick={onUndo} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onUndo(); } }} disabled={!canUndo}>Undo</button>
        <button type="button" aria-keyshortcuts="Alt+R Control+Y Meta+Y Control+Shift+Z Meta+Shift+Z" title="Redo (Alt+R or Ctrl+Y)" onClick={onRedo} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRedo(); } }} disabled={!canRedo}>Redo</button>
      </div>
      <div className="toolbar-path-row">
        {onBack && <button type="button" className="secondary-button" onClick={onBack}>Back one level</button>}
        <nav className="graph-breadcrumbs" aria-label="Graph path">
          {breadcrumbs.map((breadcrumb, index) => (
            <span key={JSON.stringify(breadcrumb.graphPath)}>
              {index > 0 && <span aria-hidden="true"> / </span>}
              <button type="button" aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined} disabled={index === breadcrumbs.length - 1} onClick={() => onNavigateBreadcrumb(index)}>
                {breadcrumb.label}
              </button>
            </span>
          ))}
        </nav>
      </div>
      <div className="toolbar-settings">
        <NumericDraftField className="toolbar-scale toolbar-horizon" label="Horizon (months)" value={horizonMonths} min={1} max={MAX_HORIZON_MONTHS} integer onCommit={onHorizonMonthsChange} />
        <label className="toolbar-scale">
          <span>Node scale</span>
          <input type="range" min="0.5" max="2" step="0.05" value={nodeScale} onChange={(event) => onNodeScaleChange(Number(event.target.value))} />
          <span>{Math.round(nodeScale * 100)}%</span>
        </label>
        <button type="button" className="toolbar-toggle secondary-button" onClick={onToggleTheme} aria-pressed={theme === 'dark'}>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </div>
      <div className="toolbar-status" aria-hidden="true">{visibleStatus}</div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{visibleStatus}</div>
      {importError && <div className="field-error toolbar-file-error">{importError}</div>}
    </div>
  );
};
