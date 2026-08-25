import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

type NumericDraftFieldProps = {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  className?: string;
};

const formatRange = (min?: number, max?: number) => {
  if (min !== undefined && max !== undefined) {
    return ` from ${min} to ${max}`;
  }
  if (min !== undefined) {
    return ` of at least ${min}`;
  }
  if (max !== undefined) {
    return ` no greater than ${max}`;
  }
  return '';
};

export const NumericDraftField = ({
  label,
  value,
  onCommit,
  min,
  max,
  step,
  integer = false,
  className,
}: NumericDraftFieldProps) => {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string>();
  const [isEditing, setIsEditing] = useState(false);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setDraft(String(value));
    }
  }, [isEditing, value]);

  const commit = () => {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    let nextError: string | undefined;
    if (trimmed === '' || !Number.isFinite(parsed)) {
      nextError = `${label} must be a finite number.`;
    } else if (integer && !Number.isInteger(parsed)) {
      nextError = `${label} must be a whole number${formatRange(min, max)}.`;
    } else if (min !== undefined && parsed < min) {
      nextError = `${label} must be at least ${min}.`;
    } else if (max !== undefined && parsed > max) {
      nextError = `${label} must be no greater than ${max}.`;
    }

    setError(nextError);
    if (nextError) {
      return false;
    }
    if (!Object.is(parsed, value)) {
      onCommit(parsed);
    }
    setDraft(String(parsed));
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commit()) {
        skipBlurCommitRef.current = true;
        event.currentTarget.blur();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(String(value));
      setError(undefined);
      skipBlurCommitRef.current = true;
      event.currentTarget.blur();
    }
  };

  return (
    <label className={className} htmlFor={inputId}>
      <span className="label">{label}</span>
      <input
        id={inputId}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        data-numeric-draft="true"
        onFocus={() => setIsEditing(true)}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) {
            setError(undefined);
          }
        }}
        onBlur={() => {
          setIsEditing(false);
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
          } else {
            commit();
          }
        }}
        onKeyDown={handleKeyDown}
        {...(step !== undefined ? { 'data-step': step } : {})}
      />
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </label>
  );
};
