import { Plugin, Store } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { en, ru } from "./i18n"

/**
 * Declarations only (no setups) so window.tsx / main.ts / settings.tsx can be typed
 * from `typeof definition` without circular imports. src/gui.tsx combines them.
 */
export const definition = Plugin.define({
  os: ["macos", "windows", "linux"] as const,
  stores: {
    /** Last selected scope, raw-editor draft and section collapse state, per app. */
    ui: Store.global(
      Schema.Struct({
        scope: Schema.Literals(["global", "project"]),
        rawDraft: Schema.String,
        rawOpen: Schema.Boolean,
        validationOpen: Schema.Boolean,
        modelsOpen: Schema.Boolean,
      }),
      // All sections start collapsed; the user's choices persist.
      { scope: "global" as const, rawDraft: "", rawOpen: false, validationOpen: false, modelsOpen: false },
    ),
  },
  i18n: { en, ru },
})

export type Definition = typeof definition
