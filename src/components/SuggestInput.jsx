import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/* A text input with a dismissible suggestion dropdown, replacing the
   native <input list> + <datalist> pattern. Android's WebView renders
   native datalist popups as a persistent overlay with no way for us (or
   the user) to close it — it can sit over the keyboard with nothing to
   tap to get rid of it. This version is plain DOM we fully control: it
   closes on picking a suggestion, tapping outside, pressing Escape, or
   the explicit close button, so the keyboard is always free to use. */
export default function SuggestInput({ id, value, onChange, suggestions, placeholder }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  const filtered = value.trim()
    ? suggestions.filter((s) => s.toLowerCase().includes(value.trim().toLowerCase()))
    : suggestions;
  const showList = open && filtered.length > 0;

  return (
    <div className="suggest" ref={wrapRef}>
      <input
        className="input" id={id} type="text" placeholder={placeholder} autoComplete="off"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      />
      {showList && (
        <div className="suggest-list" role="listbox" aria-label="Suggestions">
          <button type="button" className="suggest-close" aria-label="Close suggestions" onClick={() => setOpen(false)}>
            <Icon name="x" size={14} />
          </button>
          {filtered.slice(0, 8).map((s) => (
            <button
              type="button" key={s} className="suggest-item" role="option"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(s); setOpen(false); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
