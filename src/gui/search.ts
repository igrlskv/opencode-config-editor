import type { CatalogModel } from "./contract"

/** Lowercase haystack pieces of a model. */
function haystack(m: CatalogModel): string {
  return `${m.id} ${m.name} ${m.vendor}`.toLowerCase()
}

/** Score > 0 means the model matches the query; higher is more relevant. */
export function score(model: CatalogModel, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const tokens = q.split(/\s+/).filter(Boolean)
  const h = haystack(model)
  const id = model.id.toLowerCase()
  const name = model.name.toLowerCase()
  const vendor = model.vendor.toLowerCase()

  let total = 0
  for (const t of tokens) {
    if (id === t) { total += 100; continue }
    if (id.startsWith(t)) { total += 50; continue }
    if (name.startsWith(t)) { total += 40; continue }
    if (id.includes(t)) { total += 30; continue }
    if (name.includes(t)) { total += 20; continue }
    if (vendor.includes(t)) { total += 10; continue }
    if (h.includes(t)) { total += 5; continue }
    return 0 // one unmatched token disqualifies
  }
  return total
}

/** Filter and sort a catalog by the query. */
export function search(models: readonly CatalogModel[], query: string, limit = 100): CatalogModel[] {
  const scored: { m: CatalogModel; s: number }[] = []
  for (const m of models) {
    const s = score(m, query)
    if (s > 0) scored.push({ m, s })
  }
  scored.sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id))
  return scored.slice(0, limit).map((x) => x.m)
}
