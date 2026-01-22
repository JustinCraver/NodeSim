import type React from 'react';
import { useRef } from 'react';
import type { GraphData } from '../models/types';

type ToolbarProps = {
  onExport: () => GraphData;
  onImport: (data: GraphData) => void;
  disableCoffee: boolean;
  onToggleCoffee: (value: boolean) => void;
};

export const Toolbar = ({ onExport, onImport, disableCoffee, onToggleCoffee }: ToolbarProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const data = onExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'econgraph.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result?.toString();
      if (!text) {
        return;
      }
      const parsed = JSON.parse(text) as GraphData;
      onImport(parsed);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <div className="toolbar">
      <button type="button" onClick={handleExport}>
        Export JSON
      </button>
      <button type="button" onClick={handleImportClick}>
        Import JSON
      </button>
      <label className="toolbar-checkbox">
        <input type="checkbox" checked={disableCoffee} onChange={(event) => onToggleCoffee(event.target.checked)} />
        Disable coffee
      </label>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileChange} hidden />
    </div>
  );
};
