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
  for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
    'MutationObserver', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLButtonElement', 'Element', 'DocumentFragment', 'FocusEvent', 'PointerEvent', 'CustomEvent', 'NodeFilter', 'Text', 'SVGElement', 'ResizeObserver', 'Window']) {
    const value = (dom.window as unknown as Record<string, unknown>)[key];
    if (value !== undefined) g[key] = value;
  }
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
  // jsdom has no layout: scrolling (restored by the dialogs on close) is a no-op instead of a "not implemented" error.
  dom.window.scrollTo = () => {};
  dom.window.Element.prototype.scrollTo = () => {};
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
    alias: {
      '@workspace/api-client-react': join(root, 'tests/components/api-client-stub.ts'),
      wouter: join(root, 'tests/components/wouter-stub.tsx'),
      '@clerk/react': join(root, 'tests/components/clerk-stub.ts'),
    },
    plugins: [{
      name: 'app-alias',
      setup(b) {
        // The shared store and the people directory need the API and Clerk: screens get local stand-ins.
        const standIns: Record<string, string> = {
          '@/lib/store': 'tests/components/store-stub.tsx',
          '@/hooks/use-people': 'tests/components/people-stub.ts',
        };
        b.onResolve({ filter: /^@\// }, (args) => (standIns[args.path] && !args.importer.includes('/tests/components/')
          ? { path: join(root, standIns[args.path]!) }
          : b.resolve(`./${args.path.slice(2)}`, { resolveDir: join(root, 'src'), kind: args.kind })));
      },
    }],
    nodePaths: [join(root, 'node_modules')],
    // Vite's import.meta.env, read by the runtime-environment capture.
    define: { 'import.meta.env': JSON.stringify({ MODE: 'test', BASE_URL: '/', DEV: false, PROD: false }) },
  });
  return import(pathToFileURL(outfile).href);
}
