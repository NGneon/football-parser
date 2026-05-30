/**
 * Дозагрузка стартовых составов (11+11) для матчей с битыми/пустыми lineup в JSON.
 *
 *   node scripts/refresh-lineups.js eng-premier-2024
 *   $env:LIMIT=20; node scripts/refresh-lineups.js eng-premier-2024
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { parseMatchFull, sleep } = require('../lib/livescore')
const { attachCumulativeGoalsToMatches } = require('../lib/cumulative-goals')
const { isBrokenMatch } = require('../lib/lineup-quality')
const { hasUsableLineup } = require('../lib/lineups')

const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const LEGACY_PREMIER = path.join(__dirname, '../data/premier-league-2024-2025.json')
const CONCURRENT = parseInt(process.env.CONCURRENT || '4', 10)
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0
const ALL = process.env.ALL === '1'

function resolveDataFile(leagueId) {
	const primary = path.join(LEAGUES_DIR, `${leagueId}.json`)
	if (fs.existsSync(primary)) return primary
	if (leagueId === 'eng-premier-2024' && fs.existsSync(LEGACY_PREMIER)) {
		return LEGACY_PREMIER
	}
	return null
}

async function main() {
	const leagueId = process.argv[2] || process.env.LEAGUE_ID
	if (!leagueId) {
		console.error('Укажите id лиги: node scripts/refresh-lineups.js eng-premier-2024')
		process.exit(1)
	}

	const dataFile = resolveDataFile(leagueId)
	if (!dataFile) {
		console.error(`Файл лиги не найден: ${leagueId}`)
		process.exit(1)
	}

	const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
	let matches = data.matches.filter(m => m.url)
	if (!ALL) matches = matches.filter(isBrokenMatch)
	if (LIMIT > 0) matches = matches.slice(0, LIMIT)

	console.log(`Файл: ${dataFile}`)
	console.log(
		`Составы: ${matches.length} матчей (${leagueId})${ALL ? ' [все]' : ' [только битые]'}\n`,
	)

	if (!matches.length) {
		console.log('Нет матчей для обновления.')
		return
	}

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
					})

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
						console.warn(
							`  ⚠ пропуск сохранения: ${lineups.homePlayers?.length || 0}/11 — ${lineups.awayPlayers?.length || 0}/11`,
						)
					}
				} finally {
					await page.close()
				}
			}),
		)

		if (i > 0 && i % 40 === 0) {
			attachCumulativeGoalsToMatches(data.matches)
			fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8')
		}
		await sleep(250)
	}

	data.meta = data.meta || {}
	data.meta.lineupsRefreshedAt = new Date().toISOString()
	attachCumulativeGoalsToMatches(data.matches)
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8')
	await browser.close()

	console.log(`\n✅ Готово: ${dataFile}`)
	console.log(`   Исправлено: ${fixed}, всё ещё битые: ${stillBroken}`)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
