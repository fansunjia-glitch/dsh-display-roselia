#!/usr/bin/env node
/** Run existing DSH artifacts under a macOS write-deny sandbox. Never build DSH. */
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP = `Roselia — Nocturne 本地只读预览（仅 macOS）

用法：npm run preview -- [--dsh <官方源码目录>] [--port <0-65535>]

  --dsh <目录>  已有 DSH checkout；默认与 dsh_plugins 同级的 dsh
  --port <端口> 默认 0，由系统选择空闲端口；仅监听 127.0.0.1
  -h, --help    显示此帮助，不生成文件或启动 DSH

先在本插件目录执行 npm run build。此入口仅使用官方现有的
apps/cli/lib/bin.js 和 apps/web/dist/index.html，不构建或编辑官方项目。
macOS sandbox-exec 拒绝预览进程写入官方目录及其他目录；所有配置、
临时文件和缓存均位于本插件的 .preview/ 与 .preview-home/。
终端会显示实际访问地址；不会自动打开浏览器。按 Ctrl+C 停止预览。
`

function optionsOf(args) {
  const result = { dsh: undefined, port: '0', help: false }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h') { result.help = true; continue }
    if (argument !== '--dsh' && argument !== '--port') throw new Error(`未知参数：${argument}。使用 --help 查看用法。`)
    const value = args[++index]
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${argument} 需要一个值。`)
    if (argument === '--dsh') result.dsh = value
    else {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('--port 必须是 0 至 65535 的整数。')
      result.port = String(Number(value))
    }
  }
  return result
}

function isInside(root, target) {
  const path = relative(root, target)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

/** Seatbelt uses quoted Scheme strings. Reject controls, then escape quotes and backslashes. */
function seatbeltString(value) {
  if (/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)) throw new Error('预览路径不能包含控制字符或换行。')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

async function requiredFile(path, label) {
  try {
    if (!(await stat(path)).isFile()) throw new Error('not a file')
  } catch {
    throw new Error(`${label}不存在：${path}\n此入口不会构建官方项目；请提供已具备这些产物的 DSH checkout。`)
  }
}

/** Do not follow pre-existing output-directory links before the sandbox starts. */
async function ownedDirectory(path, pluginRoot) {
  if (!isInside(pluginRoot, path)) throw new Error(`预览输出目录越界：${path}`)
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`预览输出路径必须是普通目录：${path}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(path, { mode: 0o700 })
  }
  const canonical = await realpath(path)
  if (canonical !== path) throw new Error(`预览输出目录不能经过符号链接：${path}`)
  return path
}

async function writeOwnedFile(path, content) {
  // O_NOFOLLOW also rejects a pre-existing file symlink into the official repo.
  await writeFile(path, content, {
    encoding: 'utf8',
    mode: 0o600,
    flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
  })
}

function runSandbox(args, childEnvironment, workingDirectory) {
  return new Promise((resolveExit, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', args, {
      cwd: workingDirectory,
      env: childEnvironment,
      stdio: 'inherit',
      // A separate process group lets Ctrl+C reach the complete preview tree.
      detached: true,
    })
    let stopped = false
    let shutdownSignal
    let killTimer
    const signalExitCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }
    const signalGroup = (signal) => {
      if (child.pid === undefined) return
      try { process.kill(-child.pid, signal) }
      catch (error) { if (error.code !== 'ESRCH') console.error(`无法终止预览进程组：${error.message}`) }
    }
    const forward = (signal) => {
      if (stopped) return
      if (shutdownSignal !== undefined) { signalGroup('SIGKILL'); return }
      shutdownSignal = signal
      signalGroup(signal)
      killTimer = setTimeout(() => signalGroup('SIGKILL'), 5000)
      killTimer.unref()
    }
    const handlers = new Map(Object.keys(signalExitCode).map(signal => [signal, () => forward(signal)]))
    for (const [signal, handler] of handlers) process.on(signal, handler)
    const onExit = () => { if (!stopped) signalGroup('SIGTERM') }
    process.on('exit', onExit)
    const cleanup = () => {
      stopped = true
      clearTimeout(killTimer)
      for (const [signal, handler] of handlers) process.off(signal, handler)
      process.off('exit', onExit)
    }
    child.once('error', (error) => { cleanup(); reject(error) })
    child.once('close', (code, signal) => {
      // Remove any descendants still in the preview group after its leader exits.
      signalGroup('SIGKILL')
      cleanup()
      resolveExit(shutdownSignal !== undefined ? signalExitCode[shutdownSignal] : code ?? signalExitCode[signal] ?? 1)
    })
  })
}

async function main() {
  const options = optionsOf(process.argv.slice(2))
  if (options.help) { console.log(HELP); return 0 }
  if (process.platform !== 'darwin') throw new Error('只读预览入口目前仅支持 macOS sandbox-exec；未启动 DSH。插件本身仍可用于其他平台。')
  try { await access('/usr/bin/sandbox-exec', constants.X_OK) }
  catch { throw new Error('缺少可执行的 /usr/bin/sandbox-exec；为保证官方项目只读，拒绝启动预览。') }

  const pluginRoot = await realpath(fileURLToPath(new URL('..', import.meta.url)))
  let dshRoot
  const requestedDsh = resolve(options.dsh ?? resolve(pluginRoot, '..', '..', 'dsh'))
  try { dshRoot = await realpath(requestedDsh) }
  catch { throw new Error(`找不到 DSH 目录：${requestedDsh}。使用 --dsh 指定已有 checkout。`) }
  if (isInside(dshRoot, pluginRoot) || isInside(pluginRoot, dshRoot)) {
    throw new Error('DSH 目录与插件目录必须相互独立，不能互相包含；未生成预览文件。')
  }
  // Validate all profile paths before performing any writes.
  seatbeltString(pluginRoot)
  seatbeltString(dshRoot)
  const cli = resolve(dshRoot, 'apps/cli/lib/bin.js')
  await requiredFile(cli, 'DSH CLI 构建产物')
  await requiredFile(resolve(dshRoot, 'apps/web/dist/index.html'), 'DSH Web 构建产物')
  for (const name of ['index.js', 'client.js']) {
    const output = resolve(pluginRoot, 'lib', name)
    try { if (!(await stat(output)).isFile()) throw new Error('not a file') }
    catch { throw new Error(`缺少插件构建产物：${output}。请先在插件目录执行 npm run build。`) }
  }

  const previewRoot = await ownedDirectory(resolve(pluginRoot, '.preview'), pluginRoot)
  const previewHome = await ownedDirectory(resolve(pluginRoot, '.preview-home'), pluginRoot)
  const temporaryDirectory = await ownedDirectory(resolve(previewRoot, 'tmp'), pluginRoot)
  const cacheDirectory = await ownedDirectory(resolve(previewRoot, 'cache'), pluginRoot)
  const overlay = resolve(previewRoot, 'preview.patch.yml')
  const policy = resolve(previewRoot, 'readonly-dsh.sb')
  await writeOwnedFile(overlay, `# Isolated preview; the official checkout stays read-only.\n- insert:\n    - id: display-roselia-nocturne\n      name: ${JSON.stringify(resolve(pluginRoot, 'lib/index.js'))}\n`)
  await writeOwnedFile(policy, `(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath ${seatbeltString(previewRoot)})
  (subpath ${seatbeltString(previewHome)})
  (literal "/dev/null")
  (literal "/dev/tty"))
(deny file-write* (subpath ${seatbeltString(dshRoot)}))
`)

  const childEnvironment = {
    ...process.env,
    DSH_HOME: previewHome,
    DSH_TELEMETRY_DISABLED: '1',
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
    XDG_CACHE_HOME: cacheDirectory,
    npm_config_cache: resolve(cacheDirectory, 'npm'),
    NODE_DISABLE_COMPILE_CACHE: '1',
    NODE_OPTIONS: '',
  }
  delete childEnvironment.NODE_COMPILE_CACHE
  console.log(`Roselia 只读预览 · 官方产物：${dshRoot}\n隔离数据：${previewHome}\n仅监听 127.0.0.1；等待 DSH 输出访问地址。Ctrl+C 停止。`)
  return runSandbox([
    '-f', policy, process.execPath, cli,
    '--profile', 'web', '--patch', overlay,
    '--host', '127.0.0.1', '--port', options.port, '--no-open',
  ], childEnvironment, previewRoot)
}

try { process.exitCode = await main() }
catch (error) { console.error(`Roselia preview: ${error.message}`); process.exitCode = 1 }
