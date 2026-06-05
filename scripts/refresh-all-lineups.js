/**
 * Дозагрузка полных составов (старт + запас) для всех лиг с неполными данными.
 *
 *   npm run refresh-all-lineups
 *   $env:LIMIT=50; npm run refresh-all-lineups
 *   $env:LEAGUE_ID=eng-premier-2025; npm run refresh-all-lineups
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { parseMatchFull, sleep } = require('../lib/livescore')
const { attachCumulativeGoalsToMatches } = require('../lib/cumulative-goals')
const { isIncompleteMatch } = require('../lib/lineup-quality')
const { hasUsableLineup } = require('../lib/lineups')
const { importLeagueData, isDbEnabled, requireDb, initSchema } = require('../lib/db')

const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const LEGACY_PREMIER = path.join(__dirname, '../data/premier-league-2024-2025.json')
const CONCURRENT = parseInt(process.env.CONCURRENT || '4', 10)
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0
const ONLY_LEAGUE = process.env.LEAGUE_ID || process.argv[2] || ''

function resolveDataFile(leagueId) {
	const primary = path.join(LEAGUES_DIR, `${leagueId}.json`)
	if (fs.existsSync(primary)) return primary
	if (leagueId === 'eng-premier-2024' && fs.existsSync(LEGACY_PREMIER)) {
		return LEGACY_PREMIER
	}
	return null
}

function saveLeague(data, dataFile) {
	attachCumulativeGoalsToMatches(data.matches)
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8')
	if (isDbEnabled()) {
		const db = requireDb()
		initSchema(db)
		importLeagueData(db, data)
		db.close()
	}
}

async function refreshLeague(leagueId) {
	const dataFile = resolveDataFile(leagueId)
	if (!dataFile) {
		console.warn(`⏭ ${leagueId} — файл не найден`)
		return { fixed: 0, skipped: 0 }
	}

	const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
	let matches = data.matches.filter(m => m.url && isIncompleteMatch(m))
	if (LIMIT > 0) matches = matches.slice(0, LIMIT)

	if (!matches.length) {
		console.log(`✓ ${leagueId} — неполных составов нет`)
		return { fixed: 0, skipped: 0 }
	}

	console.log(`\n========== ${leagueId}: ${matches.length} матчей ==========`)

	const browser = await chromium.launch({
		headless: process.env.HEADLESS !== '0',
		args: ['--no-sandbox'],
	})
	const context = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		viewport: { width: 1280, height: 900 },
	})

	let fixed = 0
	let stillBroken = 0

	for (let i = 0; i < matches.length; i += CONCURRENT) {
		const batch = matches.slice(i, i + CONCURRENT)
		await Promise.all(
			batch.map(async (match, idx) => {
				const page = await context.newPage()
				try {
					const n = i + idx + 1
					console.log(
						`[${n}/${matches.length}] ${match.date} ${match.homeTeam} — ${match.awayTeam}`,
					)

					const details = await parseMatchFull(page, match.url, {
						score1: match.score1,
						score2: match.score2,
						team1: match.homeTeam,
						team2: match.awayTeam,
						matchTime: match.time,
						statusStage: match.statusStage || '',
					})

					if (details.skippedBracket) return

					if (details.status) match.status = details.status
					match.parseSkipped = details.parseSkipped || false

					if (details.status === 'finished') {
						match.firstHalfHome = details.firstHalfHome
						match.firstHalfAway = details.firstHalfAway
						match.secondHalfHome = details.secondHalfHome
						match.secondHalfAway = details.secondHalfAway
						const ht = `${details.firstHalfHome}-${details.firstHalfAway}`
						const ft = `${match.score1}-${match.score2}`
						const st = `${details.secondHalfHome}-${details.secondHalfAway}`
						match.scoreDisplay = `(${ft}) ${ht} | ${st}`
						match.homeGoals = details.homeGoals
						match.awayGoals = details.awayGoals
						match.ownGoals = details.ownGoals
					}

					const lineups = {
						homePlayers: details.homeLineup,
						awayPlayers: details.awayLineup,
					}
					if (hasUsableLineup(lineups)) {
						match.homeLineup = details.homeLineup
						match.awayLineup = details.awayLineup
						fixed++
					} else {
						stillBroken++
					}
				} finally {
					await page.close()
				}
			}),
		)

		if (i > 0 && i % 40 === 0) saveLeague(data, dataFile)
		await sleep(250)
	}

	data.meta = data.meta || {}
	data.meta.lineupsRefreshedAt = new Date().toISOString()
	saveLeague(data, dataFile)
	await browser.close()

	console.log(`✅ ${leagueId}: исправлено ${fixed}, ещё неполных ${stillBroken}`)
	return { fixed, skipped: stillBroken }
}

async function main() {
	const leagueIds = ONLY_LEAGUE
		? [ONLY_LEAGUE]
		: fs
				.readdirSync(LEAGUES_DIR)
				.filter(f => f.endsWith('.json'))
				.map(f => f.replace('.json', ''))

	let totalFixed = 0
	let totalSkipped = 0

	for (const id of leagueIds) {
		const { fixed, skipped } = await refreshLeague(id)
		totalFixed += fixed
		totalSkipped += skipped
	}

	console.log(`\n——— Итог ———`)
	console.log(`✅ Исправлено: ${totalFixed}`)
	console.log(`⚠ Ещё неполных: ${totalSkipped}`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
