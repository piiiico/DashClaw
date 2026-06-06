import fs from 'node:fs/promises';
import path from 'node:path';

const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'OPTIONS'];

// Route files may be route.js, route.ts, or route.tsx (TypeScript migration).
// The contract pins the route PATH + methods, not the source extension, so
// discovery and matching are extension-agnostic.
const ROUTE_FILE_RE = /^route\.(js|ts|tsx)$/;
function normalizeRouteFile(file) {
  return file.replace(/route\.(?:js|ts|tsx)$/, 'route');
}

async function walkRouteFiles(rootDir, routeRoot) {
  const fullRoot = path.join(rootDir, routeRoot);
  const discovered = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && ROUTE_FILE_RE.test(entry.name)) {
        const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
        const raw = await fs.readFile(fullPath, 'utf8');
        const methods = HTTP_METHODS.filter((method) => (
          new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(raw)
        ));
        discovered.push({ file: relativePath, methods });
      }
    }
  }

  await walk(fullRoot);
  return discovered.sort((a, b) => a.file.localeCompare(b.file));
}

function compareMethods(expected = [], actual = []) {
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  return expectedSorted.length === actualSorted.length
    && expectedSorted.every((method, index) => method === actualSorted[index]);
}

export async function discoverApiSurface(rootDir, contracts) {
  const entries = Object.entries(contracts.api || {});
  const discovered = {};

  for (const [key, domainContract] of entries) {
    discovered[key] = await walkRouteFiles(rootDir, domainContract.route_root);
  }

  return discovered;
}

export async function checkApiSurface(contracts, discoveredSurface = null) {
  const findings = [];
  const discovered = discoveredSurface || await discoverApiSurface(process.cwd(), contracts);

  for (const [key, domainContract] of Object.entries(contracts.api || {})) {
    const declaredRoutes = domainContract.routes || [];
    const discoveredRoutes = discovered[key] || [];
    const declaredByFile = new Map(declaredRoutes.map((route) => [normalizeRouteFile(route.file), route]));

    for (const route of discoveredRoutes) {
      const declared = declaredByFile.get(normalizeRouteFile(route.file));
      if (!declared) {
        findings.push({
          code: 'undeclared_api_route',
          message: `API contract for ${key} is missing route ${route.file}`,
        });
        continue;
      }

      if (!compareMethods(declared.methods, route.methods)) {
        findings.push({
          code: 'api_method_mismatch',
          message: `API contract methods for ${route.file} are ${declared.methods.join(', ')}, but route exports ${route.methods.join(', ')}`,
        });
      }
    }

    for (const route of declaredRoutes) {
      const discoveredRoute = discoveredRoutes.find(
        (candidate) => normalizeRouteFile(candidate.file) === normalizeRouteFile(route.file),
      );
      if (!discoveredRoute) {
        findings.push({
          code: 'missing_api_route_file',
          message: `API contract declares missing route file ${route.file}`,
        });
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    discovered,
  };
}
