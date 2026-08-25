import type React from 'react';
import { useRef, useState } from 'react';
import { MAX_HORIZON_MONTHS, MAX_IMPORT_BYTES } from '../document/graphDocument';
import type { GraphBreadcrumb } from '../graph/graphScope';
import type { GraphDocument } from '../models/types';

type ToolbarProps = {
  onExport: () => GraphDocument;
  onImportText: (text: string) => string | undefined;
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
  onExport,
  onImportText,
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
  const [importError, setImportError] = useState<string>();

  const handleExport = () => {
    const data = onExport();
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'econgraph-v1.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`Import exceeds the ${MAX_IMPORT_BYTES}-byte limit.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setImportError('The selected file could not be read.');
    reader.onload = () => {
      const text = reader.result?.toString();
      if (!text) {
        setImportError('The selected file is empty.');
        return;
      }
      setImportError(onImportText(text));
    };
    reader.readAsText(file);
  };

  return (
    <div className="toolbar">
      {onBack && (
        <button type="button" onClick={onBack}>
          Back One Level
        </button>
      )}
      <nav className="graph-breadcrumbs" aria-label="Graph path">
        {breadcrumbs.map((breadcrumb, index) => (
          <span key={JSON.stringify(breadcrumb.graphPath)}>
            {index > 0 && <span aria-hidden="true"> / </span>}
            <button
              type="button"
              aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined}
              disabled={index === breadcrumbs.length - 1}
              onClick={() => onNavigateBreadcrumb(index)}
            >
              {breadcrumb.label}
            </button>
          </span>
        ))}
      </nav>
      <button type="button" onClick={handleExport}>
        Export Project JSON
      </button>
      <button type="button" onClick={() => fileInputRef.current?.click()}>
        Import Project JSON
      </button>
      <button type="button" onClick={onUndo} disabled={!canUndo}>
        Undo
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo}>
        Redo
      </button>
      <label className="toolbar-scale">
        <span>Horizon</span>
        <input
          type="number"
          min="1"
          max={MAX_HORIZON_MONTHS}
          step="1"
          value={horizonMonths}
          onChange={(event) => onHorizonMonthsChange(Number(event.target.value))}
        />
        <span>months</span>
      </label>
      <label className="toolbar-scale">
        <span>Node scale</span>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={nodeScale}
          onChange={(event) => onNodeScaleChange(Number(event.target.value))}
        />
        <span>{Math.round(nodeScale * 100)}%</span>
      </label>
      <button
        type="button"
        className="toolbar-toggle"
        onClick={onToggleTheme}
        aria-pressed={theme === 'dark'}
      >
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
      <span role="status" aria-live="polite">
        {importError ?? documentStatus}
      </span>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} hidden />
    </div>
  );
};
