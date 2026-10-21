// Correspondance entre notre bibliotheque (ids comme OP09-004_p2) et les produits TCGplayer.

const normAbbr = s => String(s || '').toUpperCase().replace(/[\s-]/g, '')

// Mentions qui designent une version speciale. Les autres mentions entre parentheses
// sont souvent des surnoms de personnages, par exemple "Mr.3 (Galdino)".
const VARIANT_MARKERS = new Set([
  'alternate art', 'parallel', 'manga', 'wanted poster', 'sp', 'gold', 'silver',
  'reprint', 'full art', 'pirate foil', 'jolly roger foil', 'textured foil', 'box topper',
])

// Mentions entre () ou [] d'un nom, en minuscules, sans les numeros ("001", "OP05-119")
function tagsOf(name) {
  return [...name.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)]
    .map(m => (m[1] ?? m[2]).trim().toLowerCase())
    .filter(t => !/^\d+$/.test(t) && !/^[a-z]{1,4}\d*-\d+$/.test(t))
}

// Type de version d'un produit TCGplayer. Dans le set d'origine de la carte, une mention
// inconnue est un surnom; ailleurs c'est une impression speciale (promo, tournoi...).
export function productKind(name, inHomeGroup) {
  let tags = tagsOf(name)
  if (inHomeGroup) tags = tags.filter(t => VARIANT_MARKERS.has(t))
  const set = new Set(tags)
  if (set.size === 0) return 'plain'
  const only = allowed => [...set].every(t => allowed.includes(t))
  if (set.has('manga') && only(['manga', 'alternate art'])) return 'manga'
  if (set.has('wanted poster') && only(['wanted poster', 'alternate art'])) return 'wanted'
  if (only(['alternate art', 'parallel'])) return 'alt'
  if (only(['sp'])) return 'sp'
  return 'other'
}

// Type de version d'une carte de notre bibliotheque, lu dans son nom
const LIBRARY_KINDS = { 'alt art': 'alt', 'manga art': 'manga', 'wanted art': 'wanted', 'sp card': 'sp' }
export function libraryKind(card) {
  const tag = card.name.match(/\((Alt Art|Manga Art|WANTED Art|SP Card)\)/i)?.[1]
  return LIBRARY_KINDS[tag?.toLowerCase()] || 'alt'
}

// Le set d'origine de la carte (hors cartes de tournoi, release events et pre-releases)
function isHomeGroup(product, prefix) {
  const sideGroup = / (RE|ANN|PRE)$/i.test(product.groupAbbr)
  return !sideGroup && normAbbr(product.groupAbbr).includes(prefix)
}

export function buildIndex(products) {
  const byNumber = new Map()
  for (const p of products) {
    if (!p.number) continue
    if (!byNumber.has(p.number)) byNumber.set(p.number, [])
    byNumber.get(p.number).push(p)
  }
  return { byNumber }
}

function candidatesFor(index, card) {
  const base = card.id.replace(/_p\d+$/, '')
  const kind = base === card.id ? 'plain' : libraryKind(card)
  const prefix = base.split('-')[0]
  const all = (index.byNumber.get(base) || []).map(product => {
    const home = isHomeGroup(product, prefix)
    return { product, home, kind: productKind(product.name, home) }
  })
  return { kind, all, matching: all.filter(c => c.kind === kind) }
}

export function findProduct(index, card) {
  const { kind, matching } = candidatesFor(index, card)
  if (matching.length === 0) return null
  matching.sort((a, b) => Number(b.home) - Number(a.home) || a.product.productId - b.product.productId)
  return { product: matching[0].product, kind }
}

// Pour comprendre pourquoi une carte n'a pas de correspondance
export function explain(index, card) {
  const { kind, all } = candidatesFor(index, card)
  if (all.length === 0) return 'numero absent chez TCGplayer'
  return `cherche "${kind}", trouve: ${all.map(c => c.kind).join(',')}`
}

// Prix en dollars: prix du marche (ventes recentes), sinon prix median des annonces.
// Cartes normales -> ligne "Normal", versions speciales -> ligne "Foil".
export function pickPrice(product, kind) {
  const preferred = kind === 'plain' ? 'Normal' : 'Foil'
  const preferredRows = product.prices.filter(r => r.subType === preferred)
  const rows = preferredRows.length ? preferredRows : product.prices
  for (const r of rows) if (r.market != null) return { usd: r.market, from: 'market' }
  for (const r of rows) if (r.mid != null) return { usd: r.mid, from: 'mid' }
  return null
}
