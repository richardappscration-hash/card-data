// Telecharge les prix TCGplayer (via tcgcsv.com), les convertit en euros et les associe
// aux cartes de library/one-piece. Resultat: data/prices-tcgplayer.json
//
//   node collector/build-prices.mjs
//   node collector/build-prices.mjs --cache=DOSSIER   (utilise des fichiers deja telecharges)

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProducts } from './tcgcsv.mjs'
import { buildIndex, findProduct, pickPrice, explain } from './match.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIBRARY_DIR = path.join(ROOT, 'library', 'one-piece')
const OUT_PRICES = path.join(ROOT, 'data', 'prices-tcgplayer.json')
const OUT_META = path.join(ROOT, 'data', 'prices-tcgplayer-meta.json')

// Promos: un meme numero existe en des dizaines de versions, impossible de savoir laquelle est la notre
const SKIPPED_PREFIXES = new Set(['P', 'STP'])
// En dessous, on considere que le format de TCGplayer a change et on ne publie rien
const MIN_BASE_MATCH_RATE = 0.9

const cacheDir = process.argv.find(a => a.startsWith('--cache='))?.slice('--cache='.length)

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

async function getUsdToEur(previousMeta) {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const rate = json.rates?.EUR
    if (!(rate > 0.3 && rate < 2)) throw new Error(`taux invalide: ${rate}`)
    return { rate, date: json.date }
  } catch (e) {
    if (previousMeta?.rateUsdEur) {
      console.warn(`Taux de change indisponible (${e.message}), on garde celui du ${previousMeta.rateDate}`)
      return { rate: previousMeta.rateUsdEur, date: previousMeta.rateDate }
    }
    throw e
  }
}

const files = (await fs.readdir(LIBRARY_DIR)).filter(f => f.endsWith('.json')).sort()
const cards = []
for (const f of files) cards.push(...(await readJson(path.join(LIBRARY_DIR, f))).cards)
console.log(`Bibliotheque: ${cards.length} cartes dans ${files.length} fichiers`)

const { rate, date } = await getUsdToEur(await readJson(OUT_META, null))
console.log(`Taux USD -> EUR: ${rate} (${date})`)

const { products, groupCount } = await loadProducts({ cacheDir })
console.log(`TCGplayer: ${products.length} produits dans ${groupCount} groupes`)
const index = buildIndex(products)

const prices = {}
const unmatched = []
const noPrice = []
let skipped = 0, fromMid = 0
let baseTotal = 0, baseMatched = 0, altTotal = 0, altMatched = 0

for (const card of cards) {
  if (SKIPPED_PREFIXES.has(card.id.split('-')[0])) { skipped++; continue }
  const isAlt = /_p\d+$/.test(card.id)
  if (isAlt) altTotal++; else baseTotal++

  const hit = findProduct(index, card)
  if (!hit) { unmatched.push(card); continue }
  if (isAlt) altMatched++; else baseMatched++

  const price = pickPrice(hit.product, hit.kind)
  if (!price) { noPrice.push(card.id); continue }
  if (price.from === 'mid') fromMid++
  prices[card.id] = Math.round(price.usd * rate * 100) / 100
}

console.log(`\nCartes de base : ${baseMatched}/${baseTotal} trouvees chez TCGplayer`)
console.log(`Alt arts       : ${altMatched}/${altTotal} trouves`)
console.log(`Promos ignorees: ${skipped}`)
console.log(`Prix obtenus   : ${Object.keys(prices).length} (dont ${fromMid} via prix median des annonces)`)
console.log(`Trouvees mais sans aucun prix: ${noPrice.length}`)
if (unmatched.length) {
  console.log(`\nSans correspondance (${unmatched.length}):`)
  for (const c of unmatched.slice(0, 60)) console.log(`  ${c.id}  ${c.name}  -> ${explain(index, c)}`)
}

if (baseTotal > 0 && baseMatched / baseTotal < MIN_BASE_MATCH_RATE) {
  throw new Error(`Seulement ${baseMatched}/${baseTotal} cartes de base trouvees: le format de TCGplayer a peut-etre change, rien n'est publie.`)
}

const sorted = Object.fromEntries(Object.entries(prices).sort(([a], [b]) => a.localeCompare(b)))
await fs.mkdir(path.dirname(OUT_PRICES), { recursive: true })
await fs.writeFile(OUT_PRICES, JSON.stringify(sorted, null, 1) + '\n')
await fs.writeFile(OUT_META, JSON.stringify({
  updatedAt: new Date().toISOString(),
  source: 'tcgcsv.com (TCGplayer, marche americain)',
  currency: 'EUR',
  rateUsdEur: rate,
  rateDate: date,
  counts: { library: cards.length, priced: Object.keys(sorted).length, unmatched: unmatched.length, skippedPromos: skipped },
}, null, 1) + '\n')
console.log(`\nEcrit: data/prices-tcgplayer.json (${Object.keys(sorted).length} prix)`)
