import { useState, useRef, useEffect, useCallback } from 'react';
import { Popover } from '@/components/Popover';

// All IANA timezones supported by the browser runtime — used for typeahead.
// Cast required: Intl.supportedValuesOf is ES2022 but tsconfig targets ES2020.
const intlSupportedValues = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
const ALL_TZ: readonly string[] =
  typeof intlSupportedValues === 'function'
    ? intlSupportedValues('timeZone')
    : [];

const MAX_LIST = 50;

function filterTimezones(query: string): string[] {
  if (!query.trim()) return ALL_TZ.slice(0, MAX_LIST);
  const q = query.toLowerCase();
  const exact: string[] = [];
  const rest: string[] = [];
  for (const tz of ALL_TZ) {
    const lower = tz.toLowerCase();
    if (lower.startsWith(q)) exact.push(tz);
    else if (lower.includes(q)) rest.push(tz);
    if (exact.length + rest.length >= MAX_LIST) break;
  }
  return [...exact, ...rest].slice(0, MAX_LIST);
}

interface TimezoneSettingProps {
  current: string | null;
  set: (tz: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export function TimezoneSetting({ current, set, onClose }: TimezoneSettingProps) {
  const [query, setQuery] = useState(current ?? '');
  const [selected, setSelected] = useState(current ?? '');
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync once when the external value first arrives. Re-running on every
  // query change would snap the input back to `current` whenever the user
  // cleared the field, preventing them from typing a new value.
  const hydrated = useRef(false);
  useEffect(() => {
    if (current && !hydrated.current) {
      hydrated.current = true;
      setQuery(current);
      setSelected(current);
    }
  }, [current]);

  const filtered = filterTimezones(query);
  const canSave = selected !== current && selected.length > 0;

  const handleSelect = useCallback((tz: string) => {
    setSelected(tz);
    setQuery(tz);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const result = await set(selected);
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setSaveError(result.error ?? 'Save failed');
    }
  }, [canSave, selected, set, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        // React's stopPropagation only blocks React synthetic events. The
        // Popover registers a NATIVE keydown listener via addEventListener,
        // so we must stop the underlying native event too — otherwise the
        // arrow key bubbles to Popover's roving-focus and steals focus
        // away from this typeahead.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setListOpen(true);
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        const pick = filtered[activeIndex];
        if (pick) handleSelect(pick);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        if (listOpen) {
          setListOpen(false);
        } else {
          onClose();
        }
      }
    },
    [filtered, activeIndex, handleSelect, onClose, listOpen],
  );

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="relative w-full">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            setListOpen(true);
            setSaveError(null);
          }}
          onFocus={() => setListOpen(true)}
          onBlur={() => {
            // Defer so a click on a list option still registers before unmount.
            setTimeout(() => setListOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Filter timezones..."
          className={
            'w-full px-2 py-1 text-body-sm rounded-[3px] border outline-none ' +
            'bg-[var(--color-surface-base)] text-[var(--color-text-primary)] ' +
            'border-[var(--color-border-default)] focus:border-[var(--color-brand-default)]'
          }
          aria-autocomplete="list"
          aria-controls="tz-listbox"
          aria-activedescendant={`tz-option-${activeIndex}`}
        />
        <Popover
          open={listOpen}
          origin="top-left"
          slideY={2}
          trapArrowKeys={false}
          returnFocusOnClose={false}
          className={
            'absolute left-0 right-0 top-[calc(100%+4px)] z-50 ' +
            'max-h-[160px] overflow-y-auto text-body-sm rounded-[3px] ' +
            'bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)] ' +
            'drop-shadow-[0_8px_12px_rgba(0,0,0,0.45)]'
          }
        >
          <ul
            id="tz-listbox"
            ref={listRef}
            role="listbox"
            aria-label="Timezone options"
            className="m-0 p-0 list-none"
          >
            {filtered.length === 0 && (
              <li className="px-2 py-1 text-[var(--color-text-tertiary)]">No results</li>
            )}
            {filtered.map((tz, i) => (
              <li
                key={tz}
                id={`tz-option-${i}`}
                role="option"
                aria-selected={tz === selected}
                onMouseDown={(e) => {
                  // Prevent the input's blur from firing before the click handler
                  // runs (blur would defer-close the list and swallow the pick).
                  e.preventDefault();
                  handleSelect(tz);
                }}
                className={
                  'px-2 py-1 cursor-pointer ' +
                  (i === activeIndex
                    ? 'bg-[var(--color-brand-subtle)] text-[var(--color-text-primary)]'
                    : 'hover:bg-[var(--color-surface-raised)] text-[var(--color-text-secondary)]') +
                  (tz === selected ? ' font-medium' : '')
                }
              >
                {tz}
                {tz === current && (
                  <span className="ml-1 text-[var(--color-text-tertiary)]">(current)</span>
                )}
              </li>
            ))}
          </ul>
        </Popover>
      </div>
      {saveError && (
        <p className="text-footnote text-[var(--color-error-text)]">{saveError}</p>
      )}
      <div className="flex gap-2 justify-end mt-1">
        <button
          type="button"
          onClick={onClose}
          className={
            'px-3 py-1 text-body-sm rounded-[3px] border ' +
            'border-[var(--color-border-default)] text-[var(--color-text-secondary)] ' +
            'bg-transparent hover:text-[var(--color-text-primary)] btn-press'
          }
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave || saving}
          className={
            'px-3 py-1 text-body-sm-semibold rounded-[3px] ' +
            'bg-[var(--color-brand-default)] text-[var(--color-text-on-brand)] btn-press ' +
            'hover:opacity-90 transition-opacity duration-fast ease-out ' +
            'disabled:opacity-40 disabled:cursor-not-allowed'
          }
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
