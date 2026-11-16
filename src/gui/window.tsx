import { Command, MenuItem, Panel, SettingsPage } from "@opencode/plugin/gui"
import type { Plugin } from "@opencode/plugin/gui"
import type { PanelTab } from "@opencode/plugin/gui"
import { ErrorBoundary } from "solid-js"
import type { JSX } from "solid-js"
import { ConfigIpc } from "./contract"
import { SettingsView } from "./settings"
import type { definition } from "./definition"

type Setup = Plugin.Setup<typeof definition>

/** The one side-panel tab; cache it so session switches do not re-create the label. */
let configTab: PanelTab | undefined

export const setup: Setup = (ctx) => {
  const fs = ctx.main(ConfigIpc)

  /**
   * The host logs only the error message of a failed plugin render, without a stack.
   * Render the view inside a boundary so the UI degrades to a visible message instead of
   * empty space, and the full stack lands in the renderer log for debugging.
   */
  const guarded = (view: () => JSX.Element): JSX.Element => (
    <ErrorBoundary
      fallback={(err, reset) => {
        // Electron's log file keeps only the first line of an entry: flatten the stack.
        const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
        console.error(`config-editor render crash: ${text.replace(/\n/g, " | ")}`)
        return (
          <div style={{ padding: "16px", "white-space": "pre-wrap", color: "var(--v2-error-fg, #bf616a)" }}>
            <strong>{ctx.t("error.render")}</strong>
            {"\n"}
            {err instanceof Error ? err.message : String(err)}
            <div style={{ "margin-top": "12px" }}>
              <button
                type="button"
                style={{
                  cursor: "pointer",
                  padding: "4px 10px",
                  "border-radius": "6px",
                  border: "1px solid var(--v2-border, currentColor)",
                  background: "transparent",
                  color: "inherit",
                }}
                onClick={() => reset()}
              >
                {ctx.t("error.render.retry")}
              </button>
            </div>
          </div>
        )
      }}
    >
      {view()}
    </ErrorBoundary>
  )

  // Trigger the catalog fetch early so the settings page has data on first open.
  void fs.loadCatalog({}).catch(() => undefined)

  ctx.add(Command, (): Command => {
    return {
      id: "open",
      title: ctx.t("command.open"),
      group: ctx.t("command.open.group"),
      keywords: ctx.t("command.open.keywords"),
      section: "general",
      run: () => ctx.layout.settings("config-editor"),
    }
  })

  // Opens the config tab in the current session's side panel (stays in the session).
  ctx.add(Command, (): Command => {
    return {
      id: "open-panel",
      title: ctx.t("command.openPanel"),
      group: ctx.t("command.open.group"),
      keywords: `${ctx.t("command.open.keywords")} panel side session`,
      bind: "mod+shift+c",
      run: () => {
        const session = ctx.sessions.current()
        if (!session) return
        ctx.layout.open(`${ctx.id}:config`, session)
      },
    }
  })

  // A "+ menu" item in the session's side panel: same action as the command.
  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "open-config",
    icon: "settings-gear",
    get title() {
      return ctx.t("panel.menu")
    },
    get description() {
      return ctx.t("panel.menu.description")
    },
    run: () => {
      const session = ctx.sessions.current()
      if (!session) return
      ctx.layout.open(`${ctx.id}:config`, session)
    },
  })

  // The side panel tab itself: the same settings view, mounted inside the session.
  ctx.add(Panel, {
    id: "config",
    region: "side",
    width: 520,
    list: (input) => {
      if (!input.open.includes("config")) return []
      configTab ??= {
        id: "config",
        get title() {
          return ctx.t("panel.title")
        },
      }
      return [configTab]
    },
    render: () => (
      <div style={{ height: "100%", "overflow-y": "auto", "overscroll-behavior": "contain" }}>
        {guarded(() => (
          <SettingsView />
        ))}
      </div>
    ),
  })

  ctx.add(SettingsPage, {
    id: "config-editor",
    icon: "settings-gear",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        {
          id: "scope",
          title: ctx.t("scope.label"),
          description: ctx.t("description"),
          keywords: "global project config файл глобальный проектный",
        },
        { id: "models", title: ctx.t("section.models"), keywords: "models provider search default модели поиск" },
        { id: "raw", title: ctx.t("section.raw"), keywords: "json editor validate редактор" },
        { id: "validation", title: ctx.t("section.validation"), keywords: "validate errors warnings ошибки" },
      ] as const
    },
    render: (input: { readonly target?: string }) => (
      <div style={{ height: "100%", "overflow-y": "auto", "overscroll-behavior": "contain" }}>
        {guarded(() => (
          <SettingsView highlight={input.target} />
        ))}
      </div>
    ),
  })
}

export default setup
