/**
 * Mounts real React components in jsdom. esbuild compiles the components with
 * the app's aliases; the API client is replaced by api-client-stub.ts. React
 * stays external so the test and the bundle share one copy.
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');

export function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    g[key] = (dom.window as unknown as Record<string, unknown>)[key];
  }
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

export async function loadComponents() {
  // Inside the package (not node_modules, which coverage ignores), so the external
  // React resolves to the app's own copy; mapped back to src/ by the inline source map.
  mkdirSync(join(root, '.component-build'), { recursive: true });
  const outdir = mkdtempSync(join(root, '.component-build', 'run-'));
  const outfile = join(outdir, 'components.mjs');
  await build({
    entryPoints: [join(root, 'tests/components/entry.tsx')],
    outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', sourcemap: 'inline', logLevel: 'silent',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react', '@radix-ui/*', 'clsx', 'tailwind-merge', 'class-variance-authority'],
    alias: { '@workspace/api-client-react': join(root, 'tests/components/api-client-stub.ts') },
    plugins: [{
      name: 'app-alias',
      setup(b) { b.onResolve({ filter: /^@\// }, (args) => b.resolve(`./${args.path.slice(2)}`, { resolveDir: join(root, 'src'), kind: args.kind })); },
    }],
    nodePaths: [join(root, 'node_modules')],
  });
  return import(pathToFileURL(outfile).href);
}
