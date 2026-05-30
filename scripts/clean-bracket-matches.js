/**
 * Удаляет из JSON матчи с вкладкой «Сетка» на странице Livescore.
 *
 *   node scripts/clean-bracket-matches.js
 *   $env:FROM_LEAGUE="cyp-cyprus-league-2025.json"; node scripts/clean-bracket-matches.js
 *   $env:FORCE=1 — перепроверить даже уже очищенные
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { buildSummaryUrl } = require('../lib/lineups')
const { hasBracketTabInPage } = require('../lib/match-page')
const { sleep } = require('../lib/livescore')

const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const LEGACY = path.join(__dirname, '../data/premier-league-2024-2025.json')
const CONCURRENT = parseInt(process.env.CONCURRENT || '3', 10)
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0
const FORCE = process.env.FORCE === '1'
const FROM_LEAGUE = process.env.FROM_LEAGUE || ''

async function createBrowser() {
	const browser = await chromium.launch({
		headless: process.env.HEADLESS !== '0',
		args: ['--no-sandbox', '--disable-dev-shm-usage'],
	})
	const context = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	})
	await context.route('**/*', route => {
		const type = route.request().resourceType()
		if (['image', 'media', 'font'].includes(type)) return route.abort()
		return route.continue()
	})
	return { browser, context }
}

async function checkBracket(page, url) {
	if (!url) return false
	try {
		await page.goto(buildSummaryUrl(url), {
			waitUntil: 'domcontentloaded',
			timeout: 20000,
		})
		await sleep(600)
		return page.evaluate(hasBracketTabInPage)
	} catch {
		return false
	}
}

async function cleanLeagueFile(filePath) {
	const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
	if (!FORCE && data.meta?.bracketCleanedAt) {
		return { skipped: true, before: data.matches?.length || 0, removed: 0, checked: 0 }
	}

	const matches = data.matches || []
	let toCheck = matches.filter(m => m.url && !m.skippedBracket)
	if (LIMIT > 0) toCheck = toCheck.slice(0, LIMIT)

	const { browser, context } = await createBrowser()
	const bracketIds = new Set()
	let checked = 0

	try {
		for (let i = 0; i < toCheck.length; i += CONCURRENT) {
			const batch = toCheck.slice(i, i + CONCURRENT)
			await Promise.all(
				batch.map(async m => {
					const page = await context.newPage()
					try {
						if (await checkBracket(page, m.url)) {
							bracketIds.add(m.id)
						}
					} finally {
						await page.close()
					}
				}),
			)
			checked += batch.length
			if (checked % 30 === 0) {
				process.stdout.write(`  проверено ${checked}/${toCheck.length}\r`)
			}
		}
	} finally {
		await browser.close()
	}

	const before = matches.length
	const filtered = matches.filter(
		m => !bracketIds.has(m.id) && !m.skippedBracket,
	)
	const removed = before - filtered.length

	data.matches = filtered
	data.meta = data.meta || {}
	data.meta.bracketCleanedAt = new Date().toISOString()
	data.meta.bracketRemovedCount = (data.meta.bracketRemovedCount || 0) + removed
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')

	return { skipped: false, before, removed, checked: toCheck.length }
}

async function main() {
	const paths = []
	if (fs.existsSync(LEAGUES_DIR)) {
		for (const name of fs.readdirSync(LEAGUES_DIR).sort()) {
			if (name.endsWith('.json')) paths.push(path.join(LEAGUES_DIR, name))
		}
	}
	if (fs.existsSync(LEGACY)) paths.push(LEGACY)

	const todo = []
	for (const fp of paths) {
		const name = path.basename(fp)
		if (FROM_LEAGUE) {
			const fromIdx = paths.findIndex(p => path.basename(p) === FROM_LEAGUE)
			const idx = paths.indexOf(fp)
			if (fromIdx >= 0 && idx < fromIdx) continue
		}
		if (!FORCE) {
			try {
				const data = JSON.parse(fs.readFileSync(fp, 'utf8'))
				if (data.meta?.bracketCleanedAt) continue
			} catch {}
		}
		todo.push(fp)
	}

	console.log(`Лиг к проверке: ${todo.length} (из ${paths.length})\n`)

	let totalRemoved = 0
	for (const fp of todo) {
		const name = path.basename(fp)
		console.log(`\n${name}`)
		const r = await cleanLeagueFile(fp)
		if (r.skipped) {
			console.log('  ⏭ уже проверено (bracketCleanedAt)')
			continue
		}
		console.log(
			`  проверено URL: ${r.checked}, удалено: ${r.removed}, осталось: ${r.before - r.removed}`,
		)
		totalRemoved += r.removed
	}

	console.log(`\n✅ Удалено матчей с сеткой в этом запуске: ${totalRemoved}`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
