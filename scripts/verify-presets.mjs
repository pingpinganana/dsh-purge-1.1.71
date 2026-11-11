#!/usr/bin/env node
/**
 * Read-only check that every bundled agent preset is well-formed for host 0.2.x.
 *
 * Catches the three things that silently break a preset:
 *   1. `toolFilter` / `persona` on a `tool-subagent` row — host 0.2.1+ throws
 *      "is no longer supported" and the WHOLE preset is marked broken;
 *   2. `agentPreset` pointing at an id that is not declared (or not in
 *      `allowedAgentPresets`), which fails at delegation time;
 *   3. a companion `*-sub` preset that still carries delegation tools, which
 *      defeats the leaf-only guarantee.
 *
 * Usage: node scripts/verify-presets.mjs [--verbose]
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const verbose = process.argv.includes('--verbose')

const { readPresetDefinition } = await import(
  pathToFileURL(join(root, 'lib/redteam/preset-composition.js')).href
)

let failures = 0
const check = (ok, label, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
}

const presetsDir = join(root, 'presets')
if (!existsSync(presetsDir)) {
  console.error('FAIL  presets/ not found')
  process.exit(1)
}

const ids = readdirSync(presetsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  // 备份目录（`redteam.bak-*`、`.trash`）不是预设，别让它们把校验带红。
  .filter((id) => !id.startsWith('.') && !/\.bak/.test(id))
  .filter((id) => existsSync(join(presetsDir, id, 'agent.cordis.yml')))

console.log(`presets found (${ids.length}): ${ids.join(', ')}\n`)
check(ids.length >= 2, 'at least two presets bundled', String(ids.length))

const definitions = new Map()
const rawText = new Map()
for (const id of ids) {
  rawText.set(id, readFileSync(join(presetsDir, id, 'agent.cordis.yml'), 'utf8'))
  try {
    const definition = readPresetDefinition(id, join(presetsDir, id))
    definitions.set(id, definition)
    check(definition.id === id, `${id}: definition id matches directory`)
    check(
      Array.isArray(definition.plugins) && definition.plugins.length > 0,
      `${id}: has plugin rows`,
      String(definition.plugins?.length ?? 0),
    )
    check(typeof definition.name === 'string' && definition.name.length > 0, `${id}: has display name`, definition.name)
    check(!/\{\{cwd\}\}/.test(rawText.get(id).replace(/^#.*$/gm, '')),
      `${id}: no literal {{cwd}} outside comments`)
  } catch (error) {
    check(false, `${id}: parses as a composition`, error?.message || String(error))
  }
}

/** Flatten group rows: a `cordis:group` keeps its children in `config`. */
const flattenRows = (rows) => {
  const out = []
  for (const row of rows || []) {
    out.push(row)
    if (Array.isArray(row.config)) out.push(...flattenRows(row.config))
  }
  return out
}

const rowNamed = (definition, suffix) =>
  flattenRows(definition.plugins).filter((row) => String(row.name || '').endsWith(suffix))

/**
 * Package subpaths that no longer resolve. A row pointing at one of these throws
 * "never started", which takes down the whole group AND the preset with it —
 * and because the preset is then filtered from the dropdown, it looks like the
 * mode "disappeared" rather than failed.
 */
const RETIRED_SUBPATHS = new Map([
  [
    '@deepseek-ai/dsh-tool-subagent-control/list-agents',
    '0.2.2 merged list_agents into the main package; its exports no longer include this subpath',
  ],
])

const hostIdx = process.argv.indexOf('--host')
const hostModules = hostIdx > 0 ? process.argv[hostIdx + 1] : null

/** Keys of a package's `exports` map, or null when it has none (path resolution applies). */
const exportKeys = (pkgDir) => {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    const exp = pkg.exports
    if (typeof exp === 'string') return new Set(['.'])
    if (!exp || typeof exp !== 'object') return null
    return new Set(Object.keys(exp))
  } catch {
    return null
  }
}

/**
 * Why a row's `name` cannot be resolved, or null when it looks fine.
 * Mirrors what the Loader does at mount: a bare package must be installed and a
 * subpath must appear in its `exports`, otherwise the row fails with
 * "never started" — and one such row marks the whole preset broken.
 */
const resolveRow = (name, presetDir) => {
  const text = String(name || '')
  if (!text || text.startsWith('cordis:')) return null
  if (text.startsWith('./') || text.startsWith('../')) {
    const abs = join(presetDir, text)
    return existsSync(abs) ? null : `relative module not found: ${abs}`
  }
  if (text.startsWith('@deepseek-ai/')) {
    if (!hostModules) return null
    const parts = text.split('/')
    const pkgName = parts.slice(0, 2).join('/')
    const sub = parts.length > 2 ? './' + parts.slice(2).join('/') : '.'
    const pkgDir = join(hostModules, pkgName)
    if (!existsSync(pkgDir)) return `package not installed: ${pkgName}`
    const keys = exportKeys(pkgDir)
    if (sub !== '.' && keys && !keys.has(sub)) {
      return `subpath "${sub}" is not in ${pkgName} exports (rows like this fail with "never started")`
    }
    return null
  }
  if (text === 'dsh-purge' || text.startsWith('dsh-purge/')) {
    const sub = text === 'dsh-purge' ? '.' : './' + text.slice('dsh-purge/'.length)
    const keys = exportKeys(root)
    if (sub !== '.' && keys && !keys.has(sub)) return `subpath "${sub}" is not in dsh-purge exports`
    return null
  }
  return null
}

for (const [id, definition] of definitions) {
  const text = rawText.get(id)
  const presetDir = join(presetsDir, id)
  for (const row of flattenRows(definition.plugins)) {
    const why = RETIRED_SUBPATHS.get(String(row.name || ''))
    if (why) {
      check(false, `${id}: row "${row.id}" points at a retired package path`, `${row.name} — ${why}`)
    }
    if (row.disabled === true) continue
    const problem = resolveRow(row.name, presetDir)
    if (problem) check(false, `${id}: row "${row.id}" cannot resolve`, problem)
  }
  check(!/^\s*toolFilter:/m.test(text), `${id}: no toolFilter (host 0.2.1+ rejects it)`)
  check(!/^\s*persona:\s*$/m.test(text.split('- id: tool-subagent')[1]?.split('- id: ')[0] || ''),
    `${id}: no persona on the tool-subagent row`)

  for (const row of rowNamed(definition, 'dsh-tool-subagent')) {
    const config = row.config || {}
    if (config.provider !== 'spawn') continue
    const target = config.agentPreset
    if (target === undefined) continue
    check(ids.includes(target), `${id}: agentPreset "${target}" is declared`)
    const allowed = config.allowedAgentPresets
    check(
      Array.isArray(allowed) ? allowed.includes(target) : allowed === undefined,
      `${id}: allowedAgentPresets offers "${target}"`,
      JSON.stringify(allowed),
    )
    if (verbose) console.log(`      spawn row → agentPreset=${target} maxDepth=${config.maxDepth}`)
  }

  if (id.endsWith('-sub')) {
    const delegationNames = [
      'dsh-tool-subagent',
      'dsh-tool-workflow',
      'dsh-tool-ralph',
      'dsh-tool-subagent-control',
    ]
    for (const suffix of delegationNames) {
      check(
        rowNamed(definition, suffix).length === 0,
        `${id}: carries no ${suffix.replace('dsh-tool-', '')} row`,
      )
    }
    check(!/- id: delegation/.test(text), `${id}: has no delegation group`)
    check(!/- id: planning/.test(text), `${id}: has no plan-mode group (nobody can approve it)`)
  }
}

const unique = new Set(definitions.keys())
check(unique.size === ids.length, 'preset ids are unique')
check(unique.has('redteam'), 'redteam preset present')

console.log('')
if (failures > 0) {
  console.log(`FAILED — ${failures} check(s) did not pass`)
  process.exit(1)
}
console.log('OK — all bundled presets are well-formed for host 0.2.x')
