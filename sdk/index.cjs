/**
 * DashClaw SDK v2 (Stable Runtime API)
 * CommonJS compatibility bridge.
 *
 * ESM: import { DashClaw } from 'dashclaw'
 * CJS: const { DashClaw } = require('dashclaw')
 */

// Minimal CommonJS shim for the v2 SDK
// We use a simplified bridge that forwards calls to the async ESM import
let _module;

async function loadModule() {
  if (!_module) {
    _module = await import('./dashclaw.js');
  }
  return _module;
}

// Lazy error class factory: constructs a placeholder class that delegates
// instanceof checks to the real ESM class once the module loads, matching
// the Symbol.hasInstance pattern from legacy/index-v1.cjs so that
// catch(e) { if (e instanceof ApprovalDeniedError) } works across the
// ESM/CJS boundary.
function makeLazyErrorClass(name) {
  const Placeholder = class extends Error {
    constructor(...args) {
      super(...args);
      this.name = name;
    }
  };
  Object.defineProperty(Placeholder, 'name', { value: name });
  loadModule().then(m => {
    if (m[name]) {
      Object.defineProperty(Placeholder, Symbol.hasInstance, {
        value: (instance) => instance && (instance.name === name || instance instanceof m[name])
      });
    }
  });
  return Placeholder;
}

// Recursive deferred proxy. Each property access records the access path and
// returns another callable proxy; invoking the leaf awaits the async ESM import,
// walks the path on the resolved instance, and calls the real method. This makes
// both flat methods (client.guard(...)) and nested namespaces
// (client.execution.capabilities.list(...)) work across the CJS bridge, where the
// ESM instance only exists after an async import.
function makeDeferred(target, path) {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return makeDeferred(target, path.concat(String(prop)));
    },
    apply(_t, _thisArg, args) {
      return target._ready.then(() => {
        let parent = target._instance;
        for (let i = 0; i < path.length - 1; i++) parent = parent[path[i]];
        const leaf = parent && parent[path[path.length - 1]];
        if (typeof leaf !== 'function') {
          throw new Error(`Method ${path.join('.')} does not exist on DashClaw v2`);
        }
        return leaf.apply(parent, args);
      });
    },
  });
}

module.exports = {
  // Sync wrapper that returns a proxy for the DashClaw class
  DashClaw: class DashClawProxy {
    constructor(opts) {
      this._opts = opts;
      this._ready = loadModule().then(m => {
        this._instance = new m.DashClaw(opts);
      });

      return new Proxy(this, {
        get(target, prop) {
          if (prop in target) return target[prop];
          if (prop === 'then' || typeof prop === 'symbol') return undefined;
          // Defer to the async ESM instance; supports flat methods and
          // nested namespaces (e.g. client.execution.capabilities.list(...)).
          return makeDeferred(target, [String(prop)]);
        }
      });
    }

    static async create(opts) {
      const mod = await loadModule();
      return new mod.DashClaw(opts);
    }
  },

  // Errors from v2 — lazy re-exports that resolve instanceof across the
  // ESM/CJS boundary once the module has loaded.
  ApprovalDeniedError: makeLazyErrorClass('ApprovalDeniedError'),
  GuardBlockedError: makeLazyErrorClass('GuardBlockedError'),
};
