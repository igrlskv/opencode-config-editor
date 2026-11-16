import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync, watchFile, unwatchFile, type Stats } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, basename } from "node:path"
import { homedir, platform } from "node:os"
import type { Plugin } from "@opencode/plugin/gui"
import { ConfigIpc, type CatalogModel, type CatalogState, type ConfigRef } from "./contract"
import { validate } from "./validate"
import type { definition } from "./definition"

/**
 * Safety net for code evaluated outside this module's scope: ajv compiles validators with
 * `new Function`, whose generated code may `require("ajv/dist/runtime/…")` for some schema
 * keywords. A `new Function` body sees only the global scope, where `require` does not exist,
 * so expose a require that resolves against this plugin's own node_modules. A no-op when a
 * global require already exists.
 */
try {
  ;(globalThis as { require?: NodeJS.Require }).require ??= createRequire(__filename)
} catch {
  // Non-CJS context: ajv codegen paths we rely on never hit runtime requires there anyway.
}

/**
 * The global config location. OpenCode documents ~/.config/opencode for macOS and Linux;
 * on Windows it also accepts %APPDATA%\opencode (XDG-style ~/.config is unusual there), so
 * prefer %APPDATA% when it exists and fall back to ~/.config otherwise.
 */
function globalConfigPath(): string {
  if (platform() === "win32") {
    const appData = process.env.APPDATA
    if (appData) {
      const p = join(appData, "opencode", "opencode.json")
      if (existsSync(p)) return p
      const xdg = join(homedir(), ".config", "opencode", "opencode.json")
      return existsSync(xdg) ? xdg : p
    }
  }
  return join(homedir(), ".config", "opencode", "opencode.json")
}

const GLOBAL_CONFIG = globalConfigPath()

/** Project config candidates, first existing wins. */
function projectPaths(directory: string): string[] {
  return [join(directory, "opencode.json"), join(directory, ".opencode", "opencode.json")]
}

interface Options {
  providerID?: string
  catalogURL?: string
}

interface MainState {
  catalog: CatalogState
  apiKey?: string
  catalogURL: string
  watching: Map<string, () => void>
}

export const main: Plugin.MainSetup = (ctx) => {
  const options = (ctx.options ?? {}) as Options
  const providerID = options.providerID ?? "routerai"
  const state: MainState = {
    catalog: { status: "idle", models: [] },
    catalogURL: options.catalogURL ?? `https://routerai.ru/api/v1/models`,
    watching: new Map(),
  }
  ctx.log.write("info", "config-editor main started", { providerID, catalogURL: state.catalogURL })

  /** Resolve the provider API key: options override, else the global config file. */
  const resolveApiKey = (): string | undefined => {
    // 1. environment
    const envKey = process.env.ROUTERAI_API_KEY ?? process.env.OPENROUTER_API_KEY
    if (envKey) return envKey
    // 2. global config: apiKey may be literal or {file:...} / {env:...}
    try {
      if (!existsSync(GLOBAL_CONFIG)) return undefined
      const cfg = JSON.parse(readFileSync(GLOBAL_CONFIG, "utf8")) as Record<string, unknown>
      const providers = (cfg["providers"] ?? cfg["provider"]) as Record<string, Record<string, unknown>> | undefined
      const provider = providers?.[providerID]
      if (!provider) return undefined
      const opts = (provider["options"] ?? provider["settings"]) as Record<string, unknown> | undefined
      const key = opts?.["apiKey"]
      if (typeof key !== "string") return undefined
      const envRef = /^\{env:([^}]+)\}$/.exec(key)
      if (envRef) return process.env[envRef[1]!]
      const fileRef = /^\{file:([^}]+)\}$/.exec(key)
      if (fileRef) {
        const p = fileRef[1]!.trim()
        return existsSync(p) ? readFileSync(p, "utf8").trim().split(/\r?\n/)[0] : undefined
      }
      return key
    } catch {
      return undefined
    }
  }

  const fetchCatalog = async (): Promise<CatalogState> => {
    const key = resolveApiKey()
    if (!key) {
      return { status: "error", models: [], error: "key-missing" }
    }
    try {
      const res = await fetch(state.catalogURL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) {
        return { status: "error", models: [], error: `http-${res.status}` }
      }
      const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> }
      const rows = Array.isArray(body.data) ? body.data : []
      const models: CatalogModel[] = []
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : undefined
        if (!id) continue
        const slash = id.indexOf("/")
        const vendor = slash > 0 ? id.slice(0, slash) : ""
        models.push({
          id,
          name: typeof row.name === "string" && row.name.length > 0 ? row.name : id,
          vendor,
        })
      }
      return { status: "ready", models }
    } catch (e) {
      return { status: "error", models: [], error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Watch one file: poll for content changes, emit the IPC event. */
  const watch = (path: string, emit: (path: string) => void): void => {
    if (state.watching.has(path)) return
    let last = ""
    try {
      last = existsSync(path) ? readFileSync(path, "utf8") : ""
    } catch {
      last = ""
    }
    const listener = (curr: Stats): void => {
      if (curr.size === 0 && !existsSync(path)) return
      let now = ""
      try {
        now = existsSync(path) ? readFileSync(path, "utf8") : ""
      } catch {
        return
      }
      if (now !== last) {
        last = now
        emit(path)
      }
    }
    watchFile(path, { interval: 1000 }, listener)
    state.watching.set(path, () => {
      unwatchFile(path, listener)
      state.watching.delete(path)
    })
  }

  const unwatchAll = (): void => {
    for (const stop of state.watching.values()) stop()
  }
  ctx.onCleanup(unwatchAll)

  const refFor = (scope: "global" | "project", directory?: string): ConfigRef | undefined => {
    if (scope === "global") {
      return { scope, path: GLOBAL_CONFIG, exists: existsSync(GLOBAL_CONFIG) }
    }
    if (!directory) return undefined
    const candidates = projectPaths(directory)
    const existing = candidates.find((p) => existsSync(p))
    if (existing) return { scope, path: existing, exists: true }
    return { scope, path: candidates[0]!, exists: false }
  }

  /** Write atomically: tmp file + rename, with an optional .bak copy of the previous content. */
  const writeAtomic = (path: string, raw: string, backup: boolean): { ok: boolean; backupPath?: string; error?: string } => {
    try {
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      let backupPath: string | undefined
      if (backup && existsSync(path)) {
        backupPath = `${path}.bak`
        copyFileSync(path, backupPath)
      }
      const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
      writeFileSync(tmp, raw, "utf8")
      renameSync(tmp, path)
      return { ok: true, backupPath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const provider = ctx.provide(ConfigIpc, {
    refs: (input) => {
      const global = refFor("global")
      if (!global) throw new Error("global config path unavailable")
      const project = refFor("project", input.directory)
      return project ? { global, project } : { global }
    },
    read: (input) => {
      const exists = existsSync(input.path)
      const raw = exists ? readFileSync(input.path, "utf8") : ""
      // Watch every file we read so external edits reach the window.
      watch(input.path, (p) => provider.emit("changed", { path: p }))
      const scope: "global" | "project" = input.path === GLOBAL_CONFIG ? "global" : "project"
      return { ref: { scope, path: input.path, exists }, raw }
    },
    write: (input) => {
      const res = writeAtomic(input.path, input.raw, input.backup !== false)
      if (!res.ok) throw new Error(res.error ?? "write failed")
      return { ok: true, backupPath: res.backupPath }
    },
    validateRefs: () => {
      // Refs are checked inside validate(); kept as a separate method for future use.
      return { valid: true, issues: [] }
    },
    validate: (input) => validate({ raw: input.raw, mergedRaw: input.mergedRaw, isProject: input.isProject }, existsSync),
    loadCatalog: async () => {
      state.catalog = { status: "loading", models: [] }
      state.catalog = await fetchCatalog()
      return state.catalog
    },
    catalog: () => state.catalog,
  })

  // Kick off the catalog fetch so the first page open has data.
  void fetchCatalog().then((next) => {
    state.catalog = next
    ctx.log.write("info", "config-editor catalog loaded", { models: next.models.length, status: next.status })
  })

  return () => unwatchAll()
}

/** Exported for tests; not used by the plugin itself. */
export const paths = { global: GLOBAL_CONFIG, project: projectPaths }

export type MainDefinition = typeof definition
