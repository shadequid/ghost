/**
 * Shared widget-visibility state for the sidebar widgets.
 *
 * Storage: localStorage key `ghost.widgets.v5` holding `{ order, hidden }`.
 * Cross-component sync: a custom `ghost-widget-visibility-change` event so
 * the Sidebar re-renders when SystemMenuDropdown flips a toggle in the same
 * tab. (The native `storage` event only fires in OTHER tabs.)
 */

const STORAGE_KEY = 'ghost.widgets.v5';
const CHANGE_EVENT = 'ghost-widget-visibility-change';

export interface WidgetState {
  order: string[];
  hidden: Set<string>;
}

interface PersistedShape {
  order?: unknown;
  hidden?: unknown;
}

/** Read raw state from localStorage; returns `null` if unset or unreadable.
 *  Callers reconcile against their own default order. */
export function loadWidgetState(): { order: string[]; hidden: Set<string> } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    const order = Array.isArray(parsed.order)
      ? (parsed.order as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const hidden = Array.isArray(parsed.hidden)
      ? new Set((parsed.hidden as unknown[]).filter((id): id is string => typeof id === 'string'))
      : new Set<string>();
    return { order, hidden };
  } catch {
    return null;
  }
}

/** Write order + hidden to localStorage. Hidden is serialized as an array.
 *  Dispatches the change event so subscribers in the same tab re-render. */
function persist(order: string[], hidden: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, hidden: [...hidden] }));
  } catch {
    // ignore — privacy modes may block writes
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // ignore — non-browser env in tests
  }
}

/** Flip a single widget's hidden state. Preserves order. */
export function setWidgetHidden(id: string, hidden: boolean, defaultOrder: string[]): void {
  const current = loadWidgetState();
  const order = current?.order.length ? current.order : [...defaultOrder];
  const hiddenSet = current?.hidden ?? new Set<string>();
  if (hidden) hiddenSet.add(id);
  else hiddenSet.delete(id);
  persist(order, hiddenSet);
}

/** Subscribe to widget-visibility changes from any source (this tab's
 *  CHANGE_EVENT or cross-tab 'storage'). Returns an unsubscribe fn. */
export function subscribeWidgetVisibility(handler: () => void): () => void {
  const onChange = (): void => handler();
  const onStorage = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY) handler();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
