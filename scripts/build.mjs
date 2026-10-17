/**
 * Standalone DSH browser-factory build.
 *
 * Protocol reference (read-only research): DSH 0.2.1-rc.2,
 * packages/client/tsdown.client.ts and client/modules/src/client/manifest.ts.
 * This script neither imports nor writes the adjacent DSH checkout.
 */
import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { readFile, realpath, mkdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const id = manifest.name
const outputDirectory = resolve(root, 'lib')

// Runtime identities come from DSH's module table, never bundled duplicates.
// These are the baseline module rows in the researched DSH web platform.
const platformModules = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
  ...(manifest.dsh?.client?.external ?? []),
])

function insideRoot(path) {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

async function assertLocal(path) {
  const actual = await realpath(path)
  if (!insideRoot(actual)) throw new Error(`Build input is outside this plugin: ${path}`)
  return actual
}

const inlineAssets = {
  name: 'dsh-owned-inline-assets',
  setup(builder) {
    builder.onResolve({ filter: /\.css(?:\?inline)?$/ }, async (args) => {
      if (!args.path.endsWith('?inline')) {
        throw new Error('Import global CSS as "./theme.css?inline" and install it inside ctx.effect().')
      }
      const path = await assertLocal(resolve(args.resolveDir, args.path.slice(0, -'?inline'.length)))
      // A package-relative virtual ID keeps local usernames and checkout paths
      // out of published source maps. sourcesContent preserves debugger access.
      return { path: relative(root, path).split(sep).join('/'), namespace: 'dsh-css-text' }
    })
    builder.onLoad({ filter: /.*/, namespace: 'dsh-css-text' }, async ({ path: virtualPath }) => {
      const path = await assertLocal(resolve(root, virtualPath))
      const source = await readFile(path)
      const { code } = transform({ filename: path, code: source, minify: true })
      return {
        contents: `export default ${JSON.stringify(code.toString())};`,
        loader: 'js',
        resolveDir: dirname(path),
        watchFiles: [path],
      }
    })
    builder.onLoad({ filter: /\.(?:png|webp|svg|jpe?g)$/ }, async ({ path }) => {
      await assertLocal(path)
      const mediaTypes = { '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }
      const bytes = await readFile(path)
      return {
        contents: `export default ${JSON.stringify(`data:${mediaTypes[extname(path)]};base64,${bytes.toString('base64')}`)};`,
        loader: 'js',
        resolveDir: dirname(path),
        watchFiles: [path],
      }
    })
    builder.onResolve({ filter: /^[^./]/ }, ({ path }) => {
      if (platformModules.has(path)) return { path, external: true }
      if (path.startsWith('@deepseek-ai/')) {
        throw new Error(`DSH runtime import ${path} must be a declared module-table external or a type-only import.`)
      }
      if (path.startsWith('node:')) throw new Error(`Node import is unavailable in a browser plugin: ${path}`)
      return undefined
    })
  },
}

await mkdir(outputDirectory, { recursive: true })
await assertLocal(outputDirectory)
const shared = {
  absWorkingDir: root,
  bundle: true,
  target: 'es2022',
  logLevel: 'info',
  legalComments: 'none',
  metafile: true,
}
const host = await build({
  ...shared,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  packages: 'external',
})
const client = await build({
  ...shared,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: 'linked',
  sourcesContent: true,
  minify: true,
  plugins: [inlineAssets],
  define: { 'process.env.NODE_ENV': '"production"' },
  // DSH executes a registration script, not an ESM import. The factory receives
  // the loader's require function and returns the plugin's exports.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})

// Keep the build independent of files, links and dependencies outside display/.
for (const result of [host, client]) {
  for (const input of Object.keys(result.metafile.inputs)) {
    const path = input.startsWith('dsh-css-text:') ? input.slice('dsh-css-text:'.length) : input
    await assertLocal(resolve(root, path))
  }
}

// Verify the delivery contract without a DOM. Merely fetching the bundle must
// register one factory and must not run its visual effects before activation.
const registrations = []
const script = await readFile(resolve(outputDirectory, 'client.js'), 'utf8')
vm.runInNewContext(script, { window: { __ModuleLoader__: { load: (value) => registrations.push(value) } } })
if (registrations.length !== 1 || registrations[0].id !== id || typeof registrations[0].factory !== 'function') {
  throw new Error('Client output does not implement the DSH factory registration contract.')
}
const unexpectedExternal = Object.values(client.metafile.outputs)
  .flatMap(output => output.imports)
  .find(item => item.external && !platformModules.has(item.path))
if (unexpectedExternal) throw new Error(`Unknown browser external: ${unexpectedExternal.path}`)
console.log(`Built ${id}: Host ESM + DSH browser factory; all inputs belong to this plugin.`)
