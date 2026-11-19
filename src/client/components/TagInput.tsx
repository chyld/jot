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
  // Adds go to the server one at a time, in order, so fast typing never loses a tag.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(new Set<string>());

  const submit = () => {
    const input = inputRef.current;
    if (!input) return;
    const raw = input.value;
    if (!raw.trim()) return;
    const r = normalizeTag(raw);
    if (!r.ok) {
      setError(r.error); // the text stays for correction
      return;
    }
    setError(null);
    input.value = ''; // free at once for the next tag
    if (props.tags.includes(r.tag) || queued.current.has(r.tag)) return;
    queued.current.add(r.tag);
    queue.current = queue.current.then(async () => {
      try {
        const serverError = await props.onAdd(r.tag);
        if (serverError) {
          setError(serverError);
          if (!input.value) input.value = raw; // give the text back if nothing new was typed
        }
      } finally {
        queued.current.delete(r.tag);
      }
    });
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
            // Tab with text adds the tag like Enter and keeps the cursor here for the next
            // one; Tab on an empty box (and Shift+Tab, always) moves focus on as usual.
            const tabWithText = e.key === 'Tab' && !e.shiftKey && e.currentTarget.value.trim() !== '';
            if (e.key === 'Enter' || e.key === ',' || tabWithText) {
              e.preventDefault();
              submit();
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
