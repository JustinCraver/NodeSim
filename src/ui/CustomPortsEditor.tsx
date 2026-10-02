import { useEffect, useId, useRef, useState } from 'react';
import { getCompatibleInputBindingNodes, getCompatibleOutputBindingNodes } from '../graph/customBindings';
import type { CustomNodeConfig, PortDef, ValueType } from '../models/types';

type Direction = 'input' | 'output';
type PortDraft = {
  direction: Direction;
  originalId?: string;
  id: string;
  label: string;
  valueType: Exclude<ValueType, 'none'>;
  formulaId: string;
  binding: string;
};

const VALUE_TYPES: PortDraft['valueType'][] = ['scalar', 'monthly-flow', 'timeseries'];
const compatibleNodes = (custom: CustomNodeConfig, direction: Direction, valueType: ValueType) =>
  direction === 'input'
    ? getCompatibleInputBindingNodes(custom.internalGraph, valueType)
    : getCompatibleOutputBindingNodes(custom.internalGraph, valueType);

export const CustomPortsEditor = ({ custom, documentRevision, onCommit }: {
  custom: CustomNodeConfig;
  documentRevision: number;
  onCommit: (custom: CustomNodeConfig) => string | undefined;
}) => {
  const [draft, setDraft] = useState<PortDraft | null>(null);
  const [error, setError] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);
  const errorId = useId();
  const customKey = JSON.stringify(custom);

  // Authored commands (including Undo/import) invalidate drafts; recomputation/selection alone does not.
  useEffect(() => {
    setDraft(null);
    setError(undefined);
  }, [customKey, documentRevision]);

  useEffect(() => {
    if (!draft && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [draft]);

  const closeDraft = () => {
    restoreFocusRef.current = true;
    setDraft(null);
    setError(undefined);
  };

  const startDraft = (direction: Direction, trigger: HTMLButtonElement, port?: PortDef) => {
    restoreFocusRef.current = false;
    triggerRef.current = trigger;
    const ports = direction === 'input' ? custom.inputs : custom.outputs;
    let sequence = 1;
    while (ports.some((candidate) => candidate.id === `${direction}_${sequence}`) ||
      (direction === 'output' && ports.some((candidate) => candidate.formulaId === `${direction}_${sequence}`))) sequence += 1;
    const id = port?.id ?? `${direction}_${sequence}`;
    setDraft({
      direction,
      originalId: port?.id,
      id,
      label: port?.label ?? (direction === 'input' ? 'Input' : 'Output'),
      valueType: port?.valueType && port.valueType !== 'none' ? port.valueType
        : VALUE_TYPES.find((valueType) => compatibleNodes(custom, direction, valueType).length > 0) ?? 'scalar',
      formulaId: port?.formulaId ?? id,
      binding: port ? (direction === 'input' ? custom.inputBindings : custom.outputBindings)[port.id] ?? '' : '',
    });
    setError(undefined);
  };

  const applyDraft = () => {
    if (!draft) return;
    const key = draft.direction === 'input' ? 'inputs' : 'outputs';
    const bindingsKey = draft.direction === 'input' ? 'inputBindings' : 'outputBindings';
    const id = draft.originalId ?? draft.id.trim();
    if (!id || id.length > 128) {
      setError('Port ID must contain 1 to 128 characters.');
      return;
    }
    if (custom[key].some((port) => port.id === id && port.id !== draft.originalId)) {
      setError(`Port ID ${id} already exists.`);
      return;
    }
    if (!compatibleNodes(custom, draft.direction, draft.valueType).some((node) => node.id === draft.binding)) {
      setError('Choose an existing compatible internal node for the binding.');
      return;
    }
    const port: PortDef = {
      id, label: draft.label, valueType: draft.valueType,
      ...(draft.direction === 'output' ? { formulaId: draft.formulaId } : {}),
    };
    const nextError = onCommit({
      ...custom,
      [key]: draft.originalId ? custom[key].map((existing) => existing.id === draft.originalId ? port : existing) : [...custom[key], port],
      [bindingsKey]: { ...custom[bindingsKey], [id]: draft.binding },
    });
    if (nextError) setError(nextError);
    else closeDraft();
  };

  const removePort = (direction: Direction, id: string) => {
    const key = direction === 'input' ? 'inputs' : 'outputs';
    const bindingsKey = direction === 'input' ? 'inputBindings' : 'outputBindings';
    const bindings = { ...custom[bindingsKey] };
    delete bindings[id];
    setError(onCommit({ ...custom, [key]: custom[key].filter((port) => port.id !== id), [bindingsKey]: bindings }));
  };

  return (
    <section className="panel-section custom-ports" aria-label="Custom ports">
      <p className="destructive-help">Apply a complete port with an existing internal binding. Removing ports or changing types also removes incompatible connections. Undo restores both.</p>
      {(['input', 'output'] as const).map((direction) => (
        <div className="panel-section" key={direction}>
          <div className="label">{direction === 'input' ? 'Inputs' : 'Outputs'}</div>
          {(direction === 'input' ? custom.inputs : custom.outputs).map((port) => (
            <section key={port.id} className="custom-port-row" aria-label={`${direction === 'input' ? 'Input' : 'Output'} port ${port.id}`}>
              <strong>{port.label || port.id}</strong>
              <span className="custom-port-id">{port.id} · {port.valueType ?? 'scalar'}{direction === 'output' ? ` · formula ${port.formulaId}` : ''}</span>
              <span className="custom-port-id">Binding: {(direction === 'input' ? custom.inputBindings : custom.outputBindings)[port.id]}</span>
              <button type="button" disabled={draft !== null} onClick={(event) => startDraft(direction, event.currentTarget, port)}>Edit {direction}</button>
              <button type="button" disabled={draft !== null} onClick={() => removePort(direction, port.id)}>Remove {direction}</button>
            </section>
          ))}
          <button type="button" disabled={draft !== null} onClick={(event) => startDraft(direction, event.currentTarget)}>
            {direction === 'input' ? 'Add Input' : 'Add Output'}
          </button>
        </div>
      ))}
      {draft && (
        <form className="custom-port-draft" aria-label={`${draft.originalId ? 'Edit' : 'Add'} ${draft.direction} port`}
          aria-describedby={error ? errorId : undefined}
          data-port-draft="true" data-uncommitted="true" noValidate
          onSubmit={(event) => { event.preventDefault(); applyDraft(); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDraft(); } }}>
          <div className="label">{draft.originalId ? 'Edit' : 'Add'} {draft.direction} port</div>
          <label>
            <span className="label">Port ID</span>
            <input type="text" autoFocus={!draft.originalId} readOnly={Boolean(draft.originalId)} maxLength={128} value={draft.id}
              onChange={(event) => { setDraft({ ...draft, id: event.target.value }); setError(undefined); }} />
          </label>
          {draft.originalId && <span className="destructive-help">Existing port IDs stay fixed so connections keep their identity.</span>}
          <label>
            <span className="label">Port label</span>
            <input type="text" autoFocus={Boolean(draft.originalId)} maxLength={256} value={draft.label}
              onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setError(undefined); }} />
          </label>
          <label>
            <span className="label" id={`${errorId}-type`}>Port type</span>
            <select aria-labelledby={`${errorId}-type`} value={draft.valueType} onChange={(event) => {
              const valueType = event.target.value as PortDraft['valueType'];
              const binding = compatibleNodes(custom, draft.direction, valueType).some((node) => node.id === draft.binding) ? draft.binding : '';
              setDraft({ ...draft, valueType, binding }); setError(undefined);
            }}>
              {VALUE_TYPES.map((valueType) => <option key={valueType} value={valueType}>{valueType}</option>)}
            </select>
          </label>
          {draft.direction === 'output' && <label>
            <span className="label">Formula identity</span>
            <input type="text" maxLength={128} value={draft.formulaId} aria-invalid={error?.includes('formulaId') ? 'true' : undefined}
              aria-describedby={error?.includes('formulaId') ? errorId : undefined}
              onChange={(event) => { setDraft({ ...draft, formulaId: event.target.value }); setError(undefined); }} />
          </label>}
          <label>
            <span className="label" id={`${errorId}-binding`}>Internal binding</span>
            <select aria-labelledby={`${errorId}-binding`} value={draft.binding} aria-invalid={error?.includes('binding') ? 'true' : undefined} aria-describedby={error?.includes('binding') ? errorId : undefined}
              onChange={(event) => { setDraft({ ...draft, binding: event.target.value }); setError(undefined); }}>
              <option value="">Select a compatible node</option>
              {compatibleNodes(custom, draft.direction, draft.valueType).map((node) => <option key={node.id} value={node.id}>{node.label} ({node.id})</option>)}
            </select>
          </label>
          {compatibleNodes(custom, draft.direction, draft.valueType).length === 0 &&
            <p className="destructive-help">No compatible internal node exists for this type. Cancel and add one inside the custom graph, or choose another type.</p>}
          {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
          <button type="submit">Apply port</button>
          <button type="button" onClick={closeDraft}>Cancel port draft</button>
        </form>
      )}
      {!draft && error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
};
