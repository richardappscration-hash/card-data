// Pokémon: bibliothèque en français + prix, depuis TCGdex (https://tcgdex.dev)
//   library/pokemon/index.json      liste des sets, groupés par série
//   library/pokemon/<set>.json      cartes d'un set
//   data/prices-pokemon.json        { id: { eu, us } }  eu = Cardmarket (EUR), us = TCGplayer converti en EUR
//
//   node collector/pokemon.mjs
//   node collector/pokemon.mjs --sets=sv03.5,base1   (test sur quelques sets)

import path from 'node:path'
import { ROOT, getJson, readJson, writeJson, mapLimit, getUsdToEur, round2 } from './common.mjs'

const API = 'https://api.tcgdex.net/v2/fr'
const LIB_DIR = path.join(ROOT, 'library', 'pokemon')
const PRICES_FILE = path.join(ROOT, 'data', 'prices-pokemon.json')
const META_FILE = path.join(ROOT, 'data', 'prices-pokemon-meta.json')
const CONCURRENCY = 5
const ID_PREFIX = 'pkm_'

const onlySets = process.argv.find(a => a.startsWith('--sets='))?.slice(7).split(',')

// "Illustration spéciale rare" -> "ISR", "Commune" -> "C"
function rarityShort(rarity) {
  if (!rarity) return null
  const words = rarity.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  return words.map(w => w[0].toUpperCase()).join('').slice(0, 3)
}

function tcgplayerUsd(tp) {
  if (!tp) return null
  for (const key of ['normal', 'holofoil', 'reverse-holofoil', '1st-edition-holofoil', '1st-edition-normal', 'unlimited-holofoil']) {
    const price = tp[key]?.marketPrice ?? tp[key]?.midPrice
    if (price > 0) return price
  }
  for (const v of Object.values(tp)) {
    if (v && typeof v === 'object' && v.marketPrice > 0) return v.marketPrice
  }
  return null
}

function cardmarketEur(cm) {
  if (!cm) return null
  const value = [cm.trend, cm.avg30, cm['trend-holo'], cm['avg30-holo'], cm.avg].find(v => v > 0)
  return value ?? null
}

const previousMeta = await readJson(META_FILE, null)
const fx = await getUsdToEur(previousMeta && { rate: previousMeta.rateUsdEur, date: previousMeta.rateDate })
console.log(`Taux USD -> EUR: ${fx.rate} (${fx.date})`)

const allSets = await getJson(`${API}/sets`)
const sets = onlySets ? allSets.filter(s => onlySets.includes(s.id)) : allSets
console.log(`TCGdex: ${allSets.length} sets en français (${sets.length} traités)`)

// TCGdex oublie parfois un prix d'un jour à l'autre: on garde alors le dernier connu
const previousPrices = await readJson(PRICES_FILE, {})
const prices = onlySets ? { ...previousPrices } : {}
const index = []
let cardTotal = 0, detailOk = 0, withEu = 0, withUs = 0

for (const [i, s] of sets.entries()) {
  const set = await getJson(`${API}/sets/${encodeURIComponent(s.id)}`)
  if (!set?.cards?.length) continue
  // Pokémon TCG Pocket est un jeu mobile: pas de vraies cartes à collectionner
  if (set.serie?.id === 'tcgp' || /pocket/i.test(set.serie?.name || '')) continue

  // TCGdex omet au hasard le prix TCGplayer (environ 1 fois sur 3): on redemande jusqu'à 2 fois
  const details = await mapLimit(set.cards, CONCURRENCY, async c => {
    const url = `${API}/cards/${encodeURIComponent(c.id)}`
    let d = await getJson(url).catch(() => null)
    for (let retry = 0; retry < 2 && d && !d.pricing?.tcgplayer; retry++) {
      const again = await getJson(url).catch(() => null)
      if (again?.pricing?.tcgplayer) d = again
    }
    return d
  })

  const cards = set.cards.map((c, k) => {
    const d = details[k]
    if (d) detailOk++
    const id = ID_PREFIX + c.id
    const usd = tcgplayerUsd(d?.pricing?.tcgplayer)
    const eu = cardmarketEur(d?.pricing?.cardmarket) ?? previousPrices[id]?.eu ?? null
    const us = usd != null ? round2(usd * fx.rate) : previousPrices[id]?.us ?? null
    if (eu != null || us != null) prices[id] = { ...(eu != null && { eu: round2(eu) }), ...(us != null && { us }) }
    if (eu != null) withEu++
    if (us != null) withUs++
    return {
      id,
      number: c.localId,
      name: c.name,
      rarity: d?.rarity ?? null,
      rarity_short: rarityShort(d?.rarity),
      type: d?.category ?? null,
      color: d?.types?.join(' / ') ?? null,
      power: d?.hp ?? null,
      image_url: c.image ?? null,
    }
  })
  cardTotal += cards.length

  await writeJson(path.join(LIB_DIR, `${set.id}.json`), {
    set: set.id,
    name: set.name,
    game: 'pokemon',
    serie: set.serie?.name ?? null,
    releaseDate: set.releaseDate ?? null,
    cards,
  }, 0)

  index.push({
    id: set.id,
    name: set.name,
    serie: set.serie?.name ?? 'Autres',
    releaseDate: set.releaseDate ?? null,
    total: cards.length,
    logo: set.logo ?? null,
  })
  console.log(`[${i + 1}/${sets.length}] ${set.id} ${set.name}: ${cards.length} cartes`)
}

console.log(`\nCartes: ${cardTotal} | détails obtenus: ${detailOk} | prix Europe: ${withEu} | prix US: ${withUs}`)
if (cardTotal === 0 || detailOk / cardTotal < 0.8) {
  throw new Error('Trop de cartes sans détail: TCGdex a peut-être changé ou bloque, rien n\'est publié.')
}

// Sets groupés par série, du plus récent au plus ancien
if (!onlySets) {
  const groups = new Map()
  for (const s of [...index].sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))) {
    if (!groups.has(s.serie)) groups.set(s.serie, [])
    groups.get(s.serie).push(s)
  }
  await writeJson(path.join(LIB_DIR, 'index.json'), {
    game: 'pokemon',
    updatedAt: new Date().toISOString(),
    groups: [...groups].map(([label, sets]) => ({ label, sets })),
  })
}

const sorted = Object.fromEntries(Object.entries(prices).sort(([a], [b]) => a.localeCompare(b)))
await writeJson(PRICES_FILE, sorted, 0)
await writeJson(META_FILE, {
  updatedAt: new Date().toISOString(),
  source: 'TCGdex (Cardmarket pour l\'Europe, TCGplayer pour les US)',
  rateUsdEur: fx.rate,
  rateDate: fx.date,
  counts: { cards: cardTotal, priced: Object.keys(sorted).length, eu: withEu, us: withUs },
})
console.log(`Ecrit: ${Object.keys(sorted).length} prix Pokémon`)
