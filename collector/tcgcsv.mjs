import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = 'https://tcgcsv.com/tcgplayer/68' // 68 = One Piece Card Game
const USER_AGENT = 'card-data-collector (projet perso de collection One Piece)'
const DELAY_MS = 300 // site communautaire gratuit: on espace les requetes

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt === 3) throw new Error(`${url} : ${e.message}`)
      await sleep(2000 * attempt)
    }
  }
}

const field = (product, name) => (product.extendedData || []).find(e => e.name === name)?.value ?? null

// Tous les produits One Piece de TCGplayer avec leurs prix (en dollars).
// cacheDir: dossier de fichiers deja telecharges, pour tester sans rappeler le site.
export async function loadProducts({ cacheDir } = {}) {
  const load = async (file, url) => {
    if (cacheDir) return JSON.parse(await fs.readFile(path.join(cacheDir, file), 'utf8')).results
    const data = await getJson(url)
    await sleep(DELAY_MS)
    return data.results
  }

  const groups = await load('groups.json', `${BASE}/groups`)
  const out = []
  for (const g of groups) {
    const products = await load(`${g.groupId}-products.json`, `${BASE}/${g.groupId}/products`)
    const prices = await load(`${g.groupId}-prices.json`, `${BASE}/${g.groupId}/prices`)

    const pricesById = new Map()
    for (const r of prices) {
      if (!pricesById.has(r.productId)) pricesById.set(r.productId, [])
      pricesById.get(r.productId).push({ subType: r.subTypeName, market: r.marketPrice, mid: r.midPrice })
    }

    for (const p of products) {
      out.push({
        productId: p.productId,
        name: p.name,
        number: field(p, 'Number'),
        groupAbbr: g.abbreviation || '',
        prices: pricesById.get(p.productId) || [],
      })
    }
  }
  return { products: out, groupCount: groups.length }
}
