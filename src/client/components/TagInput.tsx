// Inline tags on a note: chips (each with a remove button) plus an "Add tag" box.
// Tags are checked with the same rules as the server (a-z only, 1-30 letters,
// uppercase lowercased) and invalid ones are rejected with a message.
//
// The box is deliberately uncontrolled: on Enter it reads what is actually in the
// field. (It used to submit a React-state copy of the text, which stayed empty
// whenever the value arrived without a React change event, e.g. from browser
// autofill, some input methods or extensions, so Enter silently did nothing.)
import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { normalizeTag } from '../../shared/tags';

export function TagInput(props: {
  tags: string[];
  onAdd: (tag: string) => Promise<string | null | void>;
  onRemove: (tag: string) => void;
  onOpenTag?: (tag: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const input = inputRef.current;
    if (!input || busy) return;
    const raw = input.value;
    if (!raw.trim()) return;
    const r = normalizeTag(raw);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (props.tags.includes(r.tag)) {
      input.value = '';
      return;
    }
    setBusy(true);
    try {
      const serverError = await props.onAdd(r.tag);
      if (serverError) setError(serverError);
      else if (input.value === raw) input.value = '';
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tag-input">
      <ul className="tag-list" aria-label="Tags">
        {props.tags.map((t) => (
          <li key={t} className="tag-chip">
            <button type="button" className="tag-name" title={`Notes tagged ${t}`} onClick={() => props.onOpenTag?.(t)}>
              #{t}
            </button>
            {!props.disabled && (
              <button type="button" className="tag-remove" aria-label={`Remove tag ${t}`} title={`Remove tag ${t}`} onClick={() => props.onRemove(t)}>
                <X size={14} strokeWidth={2.5} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!props.disabled && (
        <input
          ref={inputRef}
          className={`tag-add ${error ? 'has-error' : ''}`}
          placeholder="Add tag"
          aria-label="Add tag"
          aria-invalid={!!error}
          aria-describedby={error ? 'tag-error' : undefined}
          defaultValue=""
          maxLength={60}
          autoComplete="off"
          onInput={() => error && setError(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              e.currentTarget.value = '';
              setError(null);
            }
          }}
        />
      )}
      {error && (
        <span id="tag-error" role="alert" className="tag-error">
          {error}
        </span>
      )}
    </div>
  );
}
