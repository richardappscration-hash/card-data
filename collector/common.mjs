import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const USER_AGENT = 'card-data-collector (projet perso de collection de cartes)'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function getJson(url, { retries = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      if (attempt >= retries) throw new Error(`${url} : ${e.message}`)
      await sleep(1500 * attempt)
    }
  }
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}

export async function writeJson(file, data, indent = 1) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, indent) + '\n')
}

// Exécute `worker` sur chaque élément avec au plus `limit` appels en parallèle
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

// Taux USD -> EUR du jour (Banque centrale européenne via frankfurter), sinon le dernier connu
export async function getUsdToEur(previous) {
  try {
    const json = await getJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR')
    const rate = json?.rates?.EUR
    if (!(rate > 0.3 && rate < 2)) throw new Error(`taux invalide: ${rate}`)
    return { rate, date: json.date }
  } catch (e) {
    if (previous?.rate) {
      console.warn(`Taux de change indisponible (${e.message}), on garde celui du ${previous.date}`)
      return previous
    }
    throw e
  }
}

export const round2 = n => Math.round(n * 100) / 100
