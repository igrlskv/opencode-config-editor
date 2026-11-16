import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { json } from "@codemirror/lang-json"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorState, Transaction } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createLatest, Style, usePlugin } from "@opencode/plugin/gui"
import type { JSX } from "solid-js"
import { ConfigIpc, type CatalogModel, type ConfigRef, type ValidationIssue } from "./contract"
import { search } from "./search"
import type { definition } from "./definition"

// JSON editor: app-integrated theme (transparent background, app font, Nord-ish token
// colors matching the fallbacks used across this page) and syntax highlighting.
const editorTheme = EditorView.theme({
  "&": {
    fontSize: "12px",
    backgroundColor: "transparent",
    color: "inherit",
    border: "1px solid var(--v2-border, #555)",
    borderRadius: "6px",
    height: "320px",
    resize: "vertical",
    overflow: "hidden",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.5",
    overflow: "auto",
  },
  ".cm-content": { padding: "8px 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "var(--v2-text-muted, #7b8394)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(127, 127, 127, 0.08)" },
  ".cm-selectionBackground, &&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(127, 127, 127, 0.25)",
  },
})

const editorHighlight = HighlightStyle.define([
  { tag: t.propertyName, color: "#88c0d0" },
  { tag: t.string, color: "#a3be8c" },
  { tag: t.number, color: "#b48ead" },
  { tag: [t.bool, t.null], color: "#81a1c1", fontStyle: "italic" },
  { tag: t.punctuation, color: "var(--v2-text-muted, #7b8394)" },
])

/** Static CodeMirror extensions shared by every editor instance on the page. */
const editorExtensions = [
  json(),
  lineNumbers(),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  EditorView.lineWrapping,
  editorTheme,
  syntaxHighlighting(editorHighlight),
]

/** The whole settings page for one plugin context. */
export function SettingsView(props: { readonly highlight?: string }): JSX.Element {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const fs = ctx.main(ConfigIpc)
  const cfg = () => ctx.stores.ui

  // Chevron rotation and shared styles for the page.
  ctx.add(
    Style,
    `
.config-editor-chevron { transition: transform 120ms ease; }
.config-editor-chevron-closed { transform: rotate(-90deg); }
.config-editor-summary { opacity: 0.55; font-weight: 400; font-size: 12px; margin-left: 4px; }
`,
  )

  // Provider id from plugin options (options are typed as unknown).
  const providerId = (): string => {
    const opts = ctx.options as { providerID?: string } | undefined
    return opts?.providerID ?? "routerai"
  }

  // ---- project directory -------------------------------------------------

  const [lastProject, setLastProject] = createSignal<string | undefined>(undefined)
  const projectDir = (): string | undefined => ctx.sessions.current()?.directory ?? lastProject()
  onMount(() => {
    const d = ctx.sessions.current()?.directory
    if (d) setLastProject(d)
  })

  // ---- loading -----------------------------------------------------------

  type Loaded = {
    global: ConfigRef
    project?: ConfigRef
    raw: string
    /** The ref matching the selected scope, if available. */
    ref?: ConfigRef
  }

  /** Reload generation: bump to refetch the file. */
  const [version, setVersion] = createSignal(0)
  const refetch = (): void => {
    setVersion((v) => v + 1)
  }

  const load = createLatest(
    () => {
      const dir = projectDir()
      const scope = cfg().value.scope
      return { dir, scope, version: version() }
    },
    async (input, signal): Promise<Loaded> => {
      const refs = await fs.refs({ directory: input.dir }, { signal })
      const chosen: ConfigRef | undefined = input.scope === "project" ? refs.project : refs.global
      if (!chosen) return { global: refs.global, project: refs.project, raw: "" }
      const file = await fs.read({ path: chosen.path }, { signal })
      return { global: refs.global, project: refs.project, raw: file.raw, ref: chosen }
    },
  )

  const current = createMemo<Loaded | undefined>(() => {
    const l = load.latest
    return l ? { ...l } : undefined
  })

  // Follow external edits of the open file.
  fs.on("changed", (data) => {
    const ref = current()?.ref
    if (ref?.path === data.path) {
      refetch()
      // The panel must reflect the file on disk; validate it once reloaded.
      setTimeout(validateFile, 0)
    }
  })

  // ---- multi-provider support --------------------------------------------
  // ROLLBACK SWITCH: set to false to restore the single-provider behaviour
  // (the provider is fixed by options.providerID, no selector in the UI).
  const MULTI_PROVIDER = true

  /**
   * Provider entries declared in the file being edited (V1 "provider" or V2 "providers").
   * Declared AFTER `current`: the host's Solid computes memos eagerly, so a memo that reads
   * a `const` declared later would evaluate with that binding still in temporal dead zone —
   * the swallowed error left the memo undefined and crashed the render (`o().length`).
   */
  const configProviderIds = createMemo<readonly string[]>(() => {
    const c = current()
    if (!c?.raw) return []
    try {
      const parsed = JSON.parse(c.raw) as Record<string, unknown>
      const providers = (parsed["providers"] ?? parsed["provider"]) as Record<string, unknown> | undefined
      return providers && typeof providers === "object" ? Object.keys(providers) : []
    } catch {
      return []
    }
  })

  // The active provider: the user's choice among the file's providers, falling back to
  // the one from options (and to any provider the file declares).
  const [pickedProvider, setPickedProvider] = createSignal<string | undefined>(undefined)

  const activeProviderId = (): string => {
    if (MULTI_PROVIDER) {
      const picked = pickedProvider()
      const ids = configProviderIds()
      if (picked && ids.includes(picked)) return picked
      const fromOptions = providerId()
      if (ids.includes(fromOptions)) return fromOptions
      return ids[0] ?? fromOptions
    }
    return providerId()
  }

  // Keep the pick consistent when the file changes under us.
  createEffect(() => {
    const picked = pickedProvider()
    if (picked !== undefined && !configProviderIds().includes(picked)) setPickedProvider(undefined)
  })

  // Re-validate after every reload (refetch bumps `version`; scope switches change the source).
  createEffect(() => {
    void version()
    void cfg().value.scope
    const c = current()
    if (!c) return
    // Run after `current` settles, and skip the very first run while nothing is loaded yet.
    setTimeout(validateFile, 0)
  })
  // ---- validation --------------------------------------------------------

  type ValidationState = Readonly<{ valid: boolean; issues: readonly ValidationIssue[] }>

  const [validation, setValidation] = createSignal<ValidationState | undefined>(undefined)
  const [busy, setBusy] = createSignal(false)
  const [savedAt, setSavedAt] = createSignal<number | undefined>(undefined)

  /**
   * Monotonic request id: only the most recently started validation may update the
   * panel. IPC replies can arrive out of order (each project-scope check also reads
   * the global file first), so a stale "invalid" reply would otherwise overwrite a
   * newer "valid" one and the panel would keep showing an error that is gone.
   */
  let validationSeq = 0

  /** IPC output schemas are not guaranteed to be runtime-enforced: normalize defensively. */
  const normalizeValidation = (result: unknown): ValidationState | undefined => {
    if (!result || typeof result !== "object") return undefined
    const r = result as { valid?: unknown; issues?: unknown }
    return {
      valid: r.valid === true,
      issues: Array.isArray(r.issues) ? (r.issues as readonly ValidationIssue[]) : [],
    }
  }

  const applyValidation = (seq: number, result: Readonly<{ valid: boolean; issues: readonly ValidationIssue[] }> | undefined): void => {
    if (seq !== validationSeq) return
    const next = normalizeValidation(result)
    if (next === undefined) return
    setValidation(next)
  }

  const validateNow = async (raw: string): Promise<ValidationState | undefined> => {
    const c = current()
    if (!c?.ref) return undefined
    const seq = ++validationSeq
    const isProject = c.ref.scope === "project"
    let mergedRaw: string | undefined
    if (isProject) {
      try {
        const g = await fs.read({ path: c.global.path })
        mergedRaw = g.raw
      } catch {
        mergedRaw = undefined
      }
    }
    const result = normalizeValidation(await fs.validate({ raw, mergedRaw, isProject }))
    applyValidation(seq, result)
    // Resolve for callers that branch on the outcome (save/toggle), even if stale.
    return seq === validationSeq ? result : undefined
  }

  /** Debounced validation for typing in the raw editor. */
  let validationTimer: ReturnType<typeof setTimeout> | undefined

  const validateDraftSoon = (raw: string): void => {
    if (validationTimer !== undefined) clearTimeout(validationTimer)
    validationTimer = setTimeout(() => {
      validationTimer = undefined
      void validateNow(raw).catch(() => undefined)
    }, 300)
  }

  onCleanup(() => {
    if (validationTimer !== undefined) clearTimeout(validationTimer)
  })

  /** Re-validate the file on disk (after refetch or an external edit). */
  const validateFile = (): void => {
    const c = current()
    if (!c?.ref?.exists) return
    // A draft being edited takes precedence: keep showing its own validation state.
    if (cfg().value.rawDraft.trim().length > 0) return
    void validateNow(c.raw).catch(() => undefined)
  }

  // ---- actions -----------------------------------------------------------

  const prettyJson = (raw: string): string | undefined => {
    try {
      return `${JSON.stringify(JSON.parse(raw), null, 2)}\n`
    } catch {
      return undefined
    }
  }

  /** The text a programmatic edit (toggle/default) applies to: the draft if it parses, else the file. */
  const editBase = (): string | undefined => {
    const draft = cfg().value.rawDraft
    if (draft.trim().length > 0) {
      try {
        JSON.parse(draft)
        return draft
      } catch {
        // A broken draft would fail validation anyway; prefer the file so the toggle can work.
      }
    }
    return current()?.raw
  }

  /** Writes through: validate, write, drop the draft (it described the pre-write state), reload. */
  const writeRaw = async (path: string, raw: string): Promise<void> => {
    const pretty = prettyJson(raw) ?? raw
    await fs.write({ path, raw: pretty })
    setSavedAt(Date.now())
    cfg().update((d) => {
      d.rawDraft = ""
    })
    refetch()
  }

  const save = async (): Promise<void> => {
    const c = current()
    if (!c?.ref) return
    setBusy(true)
    try {
      const draft = cfg().value.rawDraft
      const raw = draft.trim().length > 0 ? draft : c.raw
      const result = await validateNow(raw)
      if (result && !result.valid) {
        ctx.toast.show({ title: ctx.t("error.saveInvalid"), variant: "error" })
        return
      }
      await writeRaw(c.ref.path, raw)
    } catch (e) {
      ctx.toast.show({ title: ctx.t("error.write"), description: String(e), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const toggleModel = async (model: CatalogModel, add: boolean): Promise<void> => {
    const c = current()
    if (!c?.ref) return
    const base = editBase()
    if (!base) return
    setBusy(true)
    try {
      const parsed = JSON.parse(base) as Record<string, unknown>
      const key = parsed["providers"] !== undefined ? "providers" : "provider"
      const providers = parsed[key] as Record<string, Record<string, unknown>> | undefined
      const pid = activeProviderId()
      if (!providers || !providers[pid]) {
        ctx.toast.show({
          title: ctx.t("error.write"),
          description: `${pid}: ${ctx.t("validation.providerMissing", { provider: pid })}`,
          variant: "error",
        })
        return
      }
      const rec = providers[pid]!
      let models = rec["models"] as Record<string, Record<string, unknown>> | undefined
      if (!models) {
        models = {}
        rec["models"] = models
      }
      if (add) {
        models[model.id] = { id: model.id, name: model.name }
      } else {
        delete models[model.id]
      }
      const raw = `${JSON.stringify(parsed, null, 2)}\n`
      const result = await validateNow(raw)
      if (result && !result.valid) return
      await writeRaw(c.ref.path, raw)
    } catch (e) {
      ctx.toast.show({ title: ctx.t("error.write"), description: String(e), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const makeDefault = async (model: CatalogModel): Promise<void> => {
    const c = current()
    if (!c?.ref) return
    setBusy(true)
    try {
      const parsed = JSON.parse(editBase() ?? "{}") as Record<string, unknown>
      parsed["model"] = `${activeProviderId()}/${model.id}`
      const raw = `${JSON.stringify(parsed, null, 2)}\n`
      const result = await validateNow(raw)
      if (result && !result.valid) return
      await writeRaw(c.ref.path, raw)
    } catch (e) {
      ctx.toast.show({ title: ctx.t("error.write"), description: String(e), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  const createProjectConfig = async (): Promise<void> => {
    const c = current()
    if (!c?.ref) return
    setBusy(true)
    try {
      const raw = `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`
      await writeRaw(c.ref.path, raw)
      ctx.toast.show({ title: ctx.t("scope.created"), variant: "success" })
    } catch (e) {
      ctx.toast.show({ title: ctx.t("error.write"), description: String(e), variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  // Catalog state: main holds it; this window follows its own snapshot.
  type CatalogSnapshot = Readonly<{ status: "idle" | "loading" | "ready" | "error"; models: readonly CatalogModel[]; error?: string }>
  const [catalog, setCatalog] = createSignal<CatalogSnapshot | undefined>(undefined)
  const refreshCatalog = async (force = false): Promise<void> => {
    try {
      const next = force ? await fs.loadCatalog({}) : await fs.catalog({})
      setCatalog(next)
    } catch {
      setCatalog({ status: "error", models: [], error: "unavailable" })
    }
  }
  onMount(() => void refreshCatalog(false))

  const configModelIds = createMemo<ReadonlySet<string>>(() => {
    const c = current()
    if (!c?.raw) return new Set()
    try {
      const parsed = JSON.parse(c.raw) as Record<string, unknown>
      const providers = (parsed["providers"] ?? parsed["provider"]) as Record<string, Record<string, unknown>> | undefined
      const rec = providers?.[activeProviderId()]
      const models = rec?.["models"] as Record<string, unknown> | undefined
      return new Set(models ? Object.keys(models) : [])
    } catch {
      return new Set()
    }
  })

  const defaultModel = createMemo<string | undefined>(() => {
    const c = current()
    if (!c?.raw) return undefined
    try {
      const parsed = JSON.parse(c.raw) as Record<string, unknown>
      return typeof parsed["model"] === "string" ? (parsed["model"] as string) : undefined
    } catch {
      return undefined
    }
  })

  const [query, setQuery] = createSignal("")
  const [onlyEnabled, setOnlyEnabled] = createSignal(false)
  const filtered = createMemo(() => {
    const models = catalog()?.models ?? []
    const found = search(Array.isArray(models) ? models : [], query(), onlyEnabled() ? Infinity : 200)
    if (!onlyEnabled()) return found
    const ids = configModelIds()
    return found.filter((m) => ids.has(m.id))
  })

  const catalogStatus = () => catalog()?.status ?? "idle"
  const scopeAvailable = () => cfg().value.scope !== "project" || current()?.project !== undefined
  const showRaw = () => {
    const draft = cfg().value.rawDraft
    return draft.trim().length > 0 ? draft : current()?.raw ?? ""
  }

  const issueLine = (i: ValidationIssue): string => {
    const base = ctx.t(i.key, i.params)
    return i.detail ? `${base} — ${i.detail}` : base
  }

  // ---- components --------------------------------------------------------

  const ScopePicker = (): JSX.Element => (
    <ui.Select
      label={ctx.t("scope.label")}
      options={[
        { value: "global", label: ctx.t("scope.global") },
        ...(projectDir() ? [{ value: "project", label: ctx.t("scope.project") }] : []),
      ]}
      value={cfg().value.scope}
      onChange={(v) =>
        cfg().update((d) => {
          d.scope = v as "global" | "project"
        })
      }
    />
  )

  const ModelRow = (row: { readonly model: CatalogModel }): JSX.Element => {
    const inConfig = () => configModelIds().has(row.model.id)
    const isDefault = () => defaultModel() === `${activeProviderId()}/${row.model.id}`
    return (
      <ui.SettingsRow
        title={
          <span>
            {row.model.name} <span style={{ opacity: 0.55 }}>({row.model.id})</span>
          </span>
        }
        description={row.model.vendor ? `${ctx.t("model.vendor")}: ${row.model.vendor}` : undefined}
      >
        <span style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <Show when={isDefault()}>
            <span style={{ "font-size": "11px", opacity: 0.7 }}>{ctx.t("model.isDefault")}</span>
          </Show>
          <Show when={inConfig() && !isDefault()}>
            <ui.Button size="small" variant="ghost-muted" disabled={busy()} onClick={() => void makeDefault(row.model)}>
              {ctx.t("model.makeDefault")}
            </ui.Button>
          </Show>
          <ui.Switch
            label={ctx.t("search.inconfig")}
            hideLabel
            checked={inConfig()}
            disabled={busy()}
            onChange={(checked) => void toggleModel(row.model, checked)}
          />
        </span>
      </ui.SettingsRow>
    )
  }

  const ValidationPanel = (): JSX.Element => (
    <Show when={validation()} keyed>
      {(v) => (
        <div style={{ "margin-top": "8px" }}>
          <Show
            when={v.valid}
            fallback={<strong style={{ color: "var(--v2-error-fg, #bf616a)" }}>{ctx.t("state.invalid")}</strong>}
          >
            <span style={{ color: "var(--v2-success-fg, #8fbcbb)" }}>
              {ctx.t("state.valid")}
              <Show when={savedAt()}> · {new Date(savedAt()!).toLocaleTimeString()}</Show>
            </span>
          </Show>
          <Show when={Array.isArray(v.issues) && v.issues.length > 0}>
            <ul style={{ "margin-top": "6px", "padding-left": "18px" }}>
              <For each={v.issues}>
                {(i) => (
                  <li>
                    <Show when={i.level === "warning"} fallback={<span>{ctx.t("validation.error")}: </span>}>
                      <span style={{ opacity: 0.7 }}>{ctx.t("validation.warning")}: </span>
                    </Show>
                    {issueLine(i)}
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      )}
    </Show>
  )

  const RawEditor = (): JSX.Element => {
    let host!: HTMLDivElement
    let view: EditorView | undefined

    const onInput = (v: string): void => {
      cfg().update((d) => {
        d.rawDraft = v
      })
      validateDraftSoon(v)
    }

    onMount(() => {
      view = new EditorView({
        state: EditorState.create({
          doc: showRaw(),
          extensions: [
            ...editorExtensions,
            EditorView.updateListener.of((u) => {
              // Only user actions (typing, paste, undo) create a draft; programmatic
              // dispatches (sync with disk, format) must not — otherwise a stale draft
              // would later be "saved" over the newer file and resurrect old content.
              if (!u.docChanged || u.transactions.every((tr) => !tr.annotation(Transaction.userEvent))) return
              onInput(u.state.doc.toString())
            }),
          ],
        }),
        parent: host,
      })
    })

    onCleanup(() => {
      view?.destroy()
      view = undefined
    })

    // External content changes (format button, reload, scope switch): replace the document
    // without touching the undo history or resetting the cursor needlessly.
    createEffect(() => {
      const next = showRaw()
      if (!view) return
      if (next === view.state.doc.toString()) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        filter: false,
      })
    })

    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "8px", "margin-top": "8px" }}>
        <div ref={host} style={{ width: "100%" }} />
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <ui.Button variant="contrast" busy={busy()} onClick={() => void save()}>
            {busy() ? ctx.t("button.saving") : ctx.t("button.save")}
          </ui.Button>
          <ui.Button
            variant="ghost-muted"
            onClick={() => {
              const pretty = prettyJson(showRaw())
              if (pretty) onInput(pretty)
            }}
          >
            {ctx.t("button.format")}
          </ui.Button>
          <ui.Button variant="ghost-muted" onClick={() => refetch()}>
            {ctx.t("button.reload")}
          </ui.Button>
          <Show when={savedAt()}>
            <span style={{ opacity: 0.6, "font-size": "12px" }}>
              {ctx.t("state.saved")} · {new Date(savedAt()!).toLocaleTimeString()}
            </span>
          </Show>
        </div>
      </div>
    )
  }

  // ---- collapsible section -----------------------------------------------

  /** A settings section with a clickable header, a collapsed summary and persisted state. */
  const Collapsible = (props: {
    readonly id: string
    readonly title: string
    readonly open: () => boolean
    readonly setOpen: (open: boolean) => void
    readonly summary: JSX.Element
    readonly children: JSX.Element
  }): JSX.Element => (
    <ui.SettingsSection title="">
      <div
        role="button"
        tabindex={0}
        aria-expanded={props.open()}
        onClick={() => props.setOpen(!props.open())}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            props.setOpen(!props.open())
          }
        }}
        style={{
          display: "flex",
          "align-items": "center",
          gap: "6px",
          cursor: "pointer",
          "font-weight": 600,
          "user-select": "none",
          padding: "2px 0",
        }}
      >
        <ui.Icon name="chevron-down" size="small" class={`config-editor-chevron${props.open() ? "" : " config-editor-chevron-closed"}`} />
        <span>{props.title}</span>
        <Show when={!props.open()}>
          <span class="config-editor-summary">{props.summary}</span>
        </Show>
      </div>
      <Show when={props.open()}>
        <div style={{ "margin-top": "8px" }}>{props.children}</div>
      </Show>
    </ui.SettingsSection>
  )

  /** Persisted section toggle. */
  const setStore = (key: "rawOpen" | "validationOpen" | "modelsOpen", value: boolean): void => {
    cfg().update((d) => {
      d[key] = value
    })
  }

  /** Auto-expand validation when errors appear (never auto-collapses). */
  createEffect(() => {
    const v = validation()
    if (v && !v.valid && !cfg().value.validationOpen) setStore("validationOpen", true)
  })

  const validationSummary = (): JSX.Element => {
    const v = validation()
    if (!v) return <span>{ctx.t("state.loading")}</span>
    const issues = Array.isArray(v.issues) ? v.issues : []
    if (v.valid && issues.length === 0)
      return <span style={{ color: "var(--v2-success-fg, #8fbcbb)" }}>{ctx.t("validation.summary.ok")}</span>
    if (v.valid)
      return (
        <span style={{ opacity: 0.75 }}>
          {ctx.t("validation.summary.issues", { count: issues.length })} ({ctx.t("state.valid")})
        </span>
      )
    return (
      <span style={{ color: "var(--v2-error-fg, #bf616a)" }}>
        {ctx.t("validation.summary.issues", { count: issues.length })}
      </span>
    )
  }

  const modelsSummary = (): JSX.Element => (
    <span>
      {ctx.t("section.models.summary", {
        enabled: String(configModelIds().size),
        catalog: String(catalog()?.models?.length ?? 0),
      })}
    </span>
  )

  // ---- page --------------------------------------------------------------

  return (
    <ui.SettingsLayout
      title={ctx.t("title")}
      description={ctx.t("description")}
      actions={
        <ui.Button variant="ghost-muted" onClick={() => refetch()}>
          {ctx.t("button.reload")}
        </ui.Button>
      }
    >
      <ui.SettingsSection title={ctx.t("scope.label")}>
        <ui.SettingsRow id="scope" title={ctx.t("scope.label")} description={projectDir() ? undefined : ctx.t("scope.project.none")}>
          <ScopePicker />
        </ui.SettingsRow>
        <Show when={current()?.ref}>
          {(ref) => (
            <ui.SettingsRow
              id="raw"
              title={<code style={{ "font-size": "12px" }}>{ref().path}</code>}
              description={ref().exists ? undefined : ctx.t("scope.project.missing")}
            >
              <Show
                when={ref().exists}
                fallback={
                  <ui.Button size="small" variant="contrast" busy={busy()} onClick={() => void createProjectConfig()}>
                    {ctx.t("scope.create")}
                  </ui.Button>
                }
              >
                <span style={{ opacity: 0.6, "font-size": "12px" }}>{ref().scope}</span>
              </Show>
            </ui.SettingsRow>
          )}
        </Show>
      </ui.SettingsSection>

      <Collapsible
        id="raw"
        title={ctx.t("section.raw")}
        open={() => cfg().value.rawOpen}
        setOpen={(v) => setStore("rawOpen", v)}
        summary={
          <Show when={current()?.ref} fallback={<span>{ctx.t("section.raw.summary.none")}</span>}>
            {(ref) => <code style={{ "font-size": "11px" }}>{ref().path}</code>}
          </Show>
        }
      >
        <Show when={current()?.ref?.exists} fallback={<span style={{ opacity: 0.7 }}>{ctx.t("scope.project.missing")}</span>}>
          <RawEditor />
        </Show>
      </Collapsible>

      <Collapsible
        id="validation"
        title={ctx.t("section.validation")}
        open={() => cfg().value.validationOpen}
        setOpen={(v) => setStore("validationOpen", v)}
        summary={validationSummary()}
      >
        <Show when={current()?.ref?.exists} fallback={<span style={{ opacity: 0.7 }}>{ctx.t("scope.project.missing")}</span>}>
          <ValidationPanel />
        </Show>
      </Collapsible>

      <Collapsible
        id="models"
        title={ctx.t("section.models")}
        open={() => cfg().value.modelsOpen}
        setOpen={(v) => setStore("modelsOpen", v)}
        summary={modelsSummary()}
      >
        <Show when={scopeAvailable()} fallback={<span style={{ opacity: 0.7 }}>{ctx.t("error.projectUnavailable")}</span>}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <Show
              when={configProviderIds().length > 0}
              fallback={<span style={{ opacity: 0.7 }}>{ctx.t("section.models.provider.none")}</span>}
            >
              <Show when={MULTI_PROVIDER && configProviderIds().length > 1}>
                <ui.Select
                  label={ctx.t("section.models.provider")}
                  options={configProviderIds().map((id) => ({ value: id, label: id }))}
                  value={activeProviderId()}
                  onChange={(v) => setPickedProvider(v)}
                />
              </Show>
              <ui.TextInput
                type="search"
                label={ctx.t("search.placeholder")}
                placeholder={ctx.t("search.placeholder")}
                value={query()}
                onInput={setQuery}
              />
              <div>
                <ui.Button
                  variant={onlyEnabled() ? "contrast" : "ghost-muted"}
                  size="small"
                  onClick={() => setOnlyEnabled(!onlyEnabled())}
                  aria-pressed={onlyEnabled()}
                >
                  {ctx.t("filter.enabled", { count: String(configModelIds().size) })}
                </ui.Button>
              </div>
            <Show when={catalogStatus() === "loading" || load.loading}>
              <div style={{ padding: "12px" }}>
                <ui.Loader size="large" />
              </div>
            </Show>
            <Show when={catalogStatus() === "error"}>
              <span style={{ color: "var(--v2-error-fg, #bf616a)" }}>
                {ctx.t("error.catalog")}
                <Show when={catalog()?.error}> ({catalog()?.error})</Show>
              </span>
            </Show>
            <Show when={catalogStatus() === "ready" && filtered().length === 0}>
              <span style={{ opacity: 0.6 }}>
                {onlyEnabled() ? ctx.t("search.empty.enabled") : ctx.t("search.empty")}
              </span>
            </Show>
            <For each={filtered()}>{(m) => <ModelRow model={m} />}</For>
            </Show>
            <span style={{ opacity: 0.55, "font-size": "11px" }}>{ctx.t("section.models.provider.catalogNote")}</span>
          </div>
        </Show>
        <div style={{ "margin-top": "8px" }}>
          <span style={{ opacity: 0.6, "font-size": "12px" }}>{ctx.t("section.models.description")}</span>
        </div>
      </Collapsible>
    </ui.SettingsLayout>
  )
}
