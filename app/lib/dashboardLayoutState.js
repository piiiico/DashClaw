const LAYOUT_STORAGE_KEY = 'dashclaw_dashboard_layouts';
const NAMED_LAYOUTS_KEY = 'dashclaw_named_layouts';
const LAYOUT_VERSION = 9;

export function loadLayouts(storage = globalThis?.localStorage) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== LAYOUT_VERSION) return null;
    return parsed.layouts;
  } catch {
    return null;
  }
}

export function saveLayouts(layouts, storage = globalThis?.localStorage) {
  try {
    if (storage) {
      storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, layouts }));
    }
  } catch {
    // ignore storage errors
  }
}

export function clearLayouts(storage = globalThis?.localStorage) {
  try {
    if (storage) {
      storage.removeItem(LAYOUT_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function loadNamedLayouts(storage = globalThis?.localStorage) {
  try {
    if (!storage) return {};
    const raw = storage.getItem(NAMED_LAYOUTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveNamedLayout(name, layouts, storage = globalThis?.localStorage) {
  try {
    if (!storage) return;
    const named = loadNamedLayouts(storage);
    named[name] = { layouts, savedAt: new Date().toISOString() };
    storage.setItem(NAMED_LAYOUTS_KEY, JSON.stringify(named));
  } catch {
    // ignore storage errors
  }
}

export function deleteNamedLayout(name, storage = globalThis?.localStorage) {
  try {
    if (!storage) return;
    const named = loadNamedLayouts(storage);
    delete named[name];
    storage.setItem(NAMED_LAYOUTS_KEY, JSON.stringify(named));
  } catch {
    // ignore storage errors
  }
}
