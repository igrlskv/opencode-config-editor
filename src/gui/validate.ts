import Ajv2020, { type ErrorObject } from "ajv/dist/2020"
import addFormats from "ajv-formats"
import configSchemaJson from "../schema/config.schema.json"
import modelSchemaJson from "../schema/model-schema.json"
import type { ValidationIssue, ValidationResult } from "./contract"

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

// The OpenCode config schema is JSON Schema draft 2020-12; the default ajv export only speaks draft-07.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: false })
addFormats(ajv)
// The config schema references https://models.dev/model-schema.json#/$defs/Model.
ajv.addSchema(modelSchemaJson as object)
const validateSchema = ajv.compile(configSchemaJson as object)

export interface ValidateInput {
  raw: string
  mergedRaw?: string
  isProject?: boolean
}

export interface FileRefCheck {
  missing: string[]
}

/** Strings like "{file:/path}" or "{env:NAME}" in raw text. */
const FILE_REF = /\{file:([^}]+)\}/g
const ENV_REF = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

function parseJson(raw: string): { ok: true; value: Json } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as Json }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function asRecord(v: Json | undefined): Record<string, Json> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : undefined
}

function ajvIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  if (!errors) return []
  const out: ValidationIssue[] = []
  for (const err of errors) {
    if (err.keyword === "if" || err.keyword === "then" || err.keyword === "else") continue
    out.push({
      level: "error",
      key: "validation.schema",
      params: {},
      path: err.instancePath || "/",
      detail: `${err.instancePath || "/"}: ${err.message ?? ""}`.trim(),
    })
  }
  return out
}

/**Providers that hold model entries, V1 ("provider") or V2 ("providers") shape. */
function providersOf(config: Record<string, Json>): Record<string, Json> {
  return asRecord(config["providers"]) ?? asRecord(config["provider"]) ?? {}
}

function modelEntries(provider: Record<string, Json>): string[] {
  const models = asRecord(provider["models"])
  return models ? Object.keys(models) : []
}

/** Cross-file and shape rules beyond the JSON schema. */
function customRules(
  config: Record<string, Json>,
  merged: Record<string, Json> | undefined,
  isProject: boolean,
  refs: FileRefCheck,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const target = merged ?? config

  // "model" must be provider/model[#variant] — the schema enforces the shape; check existence.
  // The model id itself may contain slashes (e.g. "z-ai/glm-5.3-flash"), so only the
  // provider segment excludes them — same shape as the schema's pattern.
  const model = config["model"]
  if (typeof model === "string") {
    const m = /^([^/#]+)\/([^#]+)(?:#([^/#]+))?$/.exec(model)
    if (!m) {
      issues.push({ level: "error", key: "validation.modelFormat", params: {} })
    } else {
      const [, providerID, modelID] = m
      const provider = asRecord(target["providers"] ?? target["provider"])?.[providerID]
      const providerRec = asRecord(providersOf(target)[providerID] as Json | undefined) ?? asRecord(provider as Json | undefined)
      const models = providerRec ? modelEntries(providerRec) : []
      if (models.length > 0 && !models.includes(modelID)) {
        issues.push({
          level: "error",
          key: "validation.modelMissing",
          params: { model },
        })
      }
    }
  }

  // Every provider referenced anywhere must exist in the merged config.
  const defined = new Set(Object.keys(providersOf(target)))
  for (const [id] of Object.entries(providersOf(config))) {
    if (!defined.has(id)) {
      issues.push({ level: "error", key: "validation.providerMissing", params: { provider: id } })
    }
  }

  // enabled_providers entries must exist.
  const enabled = config["enabled_providers"]
  if (Array.isArray(enabled)) {
    for (const id of enabled) {
      if (typeof id === "string" && !defined.has(id)) {
        issues.push({ level: "error", key: "validation.enabledProviderMissing", params: { provider: id } })
      }
    }
  }

  // Missing {file:...} targets.
  for (const p of refs.missing) {
    issues.push({ level: "error", key: "validation.fileRefMissing", params: { path: p } })
  }

  // Literal API keys in a project config risk being committed.
  if (isProject) {
    const text = JSON.stringify(config)
    for (const [, providerID] of Object.entries(providersOf(config))) {
      const rec = asRecord(providerID)
      if (!rec) continue
      const options = asRecord(rec["options"]) ?? asRecord(rec["settings"])
      const key = options?.["apiKey"]
      if (typeof key === "string" && key.length > 0 && !/^\{(file|env):/.test(key)) {
        issues.push({ level: "warning", key: "validation.projectKey", params: {} })
      }
    }
    if (/\b(sk|key|token)-?[A-Za-z0-9_-]{16,}\b/.test(text) === false) {
      // no literal key patterns found; nothing to add
    }
  }

  return issues
}

/** Find {file:...} targets that do not exist, and report unreadable {env:...} as fine (env is external). */
export function checkFileRefs(config: Record<string, Json>, existsSync: (path: string) => boolean): FileRefCheck {
  const missing: string[] = []
  const visit = (v: Json): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(FILE_REF)) {
        const p = m[1]?.trim()
        if (p && !existsSync(p) && !missing.includes(p)) missing.push(p)
      }
    } else if (Array.isArray(v)) {
      v.forEach(visit)
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(visit)
    }
  }
  visit(config)
  return { missing }
}

/** Full validation: syntax → schema → custom rules. */
export function validate(input: ValidateInput, existsSync: (path: string) => boolean): ValidationResult {
  const issues: ValidationIssue[] = []

  const parsed = parseJson(input.raw)
  if (!parsed.ok) {
    return {
      valid: false,
      issues: [{ level: "error", key: "validation.syntax", params: {}, detail: parsed.error }],
    }
  }
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return {
      valid: false,
      issues: [{ level: "error", key: "validation.schema", params: {}, detail: "root must be an object" }],
    }
  }
  const config = parsed.value as Record<string, Json>

  if (!validateSchema(config)) {
    issues.push(...ajvIssues(validateSchema.errors))
  }

  let merged: Record<string, Json> | undefined
  if (input.mergedRaw) {
    const m = parseJson(input.mergedRaw)
    if (m.ok && m.value && typeof m.value === "object" && !Array.isArray(m.value)) {
      merged = m.value as Record<string, Json>
    }
  }

  issues.push(...customRules(config, merged, input.isProject === true, checkFileRefs(config, existsSync)))

  return { valid: !issues.some((i) => i.level === "error"), issues }
}
