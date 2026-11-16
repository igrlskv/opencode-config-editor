import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** Where a config file lives. */
export const Scope = Schema.Literals(["global", "project"])

/** A model in the provider catalog. */
export const CatalogModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Vendor prefix before "/" in the id, or "" when the id has none. */
  vendor: Schema.String,
})

/** A model entry as it appears in the config. */
export const ConfigModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

export const ConfigRef = Schema.Struct({
  scope: Scope,
  /** Absolute path of the file. */
  path: Schema.String,
  /** False when the file does not exist yet. */
  exists: Schema.Boolean,
  /** For the project scope: why the scope is unavailable; empty when available. */
  unavailable: Schema.optional(Schema.String),
})

/** Result of a validation pass. */
export const ValidationIssue = Schema.Struct({
  level: Schema.Literals(["error", "warning"]),
  /** i18n key of the message. */
  key: Schema.String,
  params: Schema.Record(Schema.String, Schema.String),
  /** Schema instance path, when the issue comes from ajv. */
  path: Schema.optional(Schema.String),
  /** Raw ajv/schema message, shown as detail. */
  detail: Schema.optional(Schema.String),
})

export const ValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  issues: Schema.Array(ValidationIssue),
})

/** Read of one config file. */
export const ConfigFile = Schema.Struct({
  ref: ConfigRef,
  /** Raw file content; "" when the file does not exist. */
  raw: Schema.String,
})

/** State of the provider catalog fetch. */
export const CatalogState = Schema.Struct({
  status: Schema.Literals(["idle", "loading", "ready", "error"]),
  models: Schema.Array(CatalogModel),
  /** Error message when status is "error". */
  error: Schema.optional(Schema.String),
})

/**
 * Main-process bridge. All file access, catalog fetching and watching happen in
 * the Electron main process; the window renders and decides.
 */
export const ConfigIpc = Ipc.define({
  id: "opencode-config-editor.fs",
  methods: {
    /** Both config refs at once (global + project, when a project is known). */
    refs: {
      input: Schema.Struct({ directory: Schema.optional(Schema.String) }),
      output: Schema.Struct({
        global: ConfigRef,
        project: Schema.optional(ConfigRef),
      }),
    },
    /** Read the raw content of one config file. */
    read: {
      input: Schema.Struct({ path: Schema.String }),
      output: ConfigFile,
    },
    /** Atomic write with a .bak backup of the previous content. */
    write: {
      input: Schema.Struct({ path: Schema.String, raw: Schema.String, backup: Schema.optional(Schema.Boolean) }),
      output: Schema.Struct({ ok: Schema.Boolean, backupPath: Schema.optional(Schema.String) }),
    },
    /** One-time resolve of {file:...}/{env:...} references, for validation. */
    validateRefs: {
      input: Schema.Struct({ raw: Schema.String, base: Schema.String }),
      output: ValidationResult,
    },
    /** Full validation of raw JSON against the bundled schema + custom rules. */
    validate: {
      input: Schema.Struct({
        raw: Schema.String,
        /** Merged global+project raw JSON, for cross-file checks. */
        mergedRaw: Schema.optional(Schema.String),
        isProject: Schema.optional(Schema.Boolean),
      }),
      output: ValidationResult,
    },
    /** Kick off (or refresh) the provider model catalog fetch. */
    loadCatalog: {
      input: Schema.Struct({}),
      output: CatalogState,
    },
    /** Read the current catalog state without refetching. */
    catalog: {
      input: Schema.Struct({}),
      output: CatalogState,
    },
  },
  events: {
    /** The config file changed on disk (external edit or our own write). */
    changed: Schema.Struct({ path: Schema.String }),
  },
})

export type Scope = Schema.Schema.Type<typeof Scope>
export type CatalogModel = Schema.Schema.Type<typeof CatalogModel>
export type ConfigModel = Schema.Schema.Type<typeof ConfigModel>
export type ConfigRef = Schema.Schema.Type<typeof ConfigRef>
export type ValidationIssue = Schema.Schema.Type<typeof ValidationIssue>
export type ValidationResult = Schema.Schema.Type<typeof ValidationResult>
export type ConfigFile = Schema.Schema.Type<typeof ConfigFile>
export type CatalogState = Schema.Schema.Type<typeof CatalogState>
