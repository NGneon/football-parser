/**
 * Обновляет голы и счёт по таймам в уже загруженном JSON лиги.
 *
 *   node scripts/refresh-goals.js de-bundesliga-2024
 *   $env:LIMIT=10; node scripts/refresh-goals.js eng-premier-2024
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const { parseMatchFull, parseGoalsOnly, sleep } = require('../lib/livescore')
const { attachCumulativeGoalsToMatches } = require('../lib/cumulative-goals')
const { isBrokenMatch } = require('../lib/lineup-quality')

const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const LEGACY_PREMIER = path.join(__dirname, '../data/premier-league-2024-2025.json')
const CONCURRENT = parseInt(process.env.CONCURRENT || '4', 10)
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0
const ONLY_BROKEN = process.env.ONLY_BROKEN === '1'
/** Только таймлайн (без перезагрузки составов) — быстрее; для битых составов принудительно полный парс */
const GOALS_ONLY =
	process.env.GOALS_ONLY === '1' ||
	(process.env.GOALS_ONLY !== '0' && !ONLY_BROKEN)

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
		console.error('Укажите id лиги: node scripts/refresh-goals.js de-bundesliga-2024')
		process.exit(1)
	}

	const dataFile = resolveDataFile(leagueId)
	if (!dataFile) {
		console.error(`Файл лиги не найден для id: ${leagueId}`)
		process.exit(1)
	}

	const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'))
	let matches = data.matches.filter(m => m.url)
	if (ONLY_BROKEN) matches = matches.filter(isBrokenMatch)
	if (LIMIT > 0) matches = matches.slice(0, LIMIT)

	console.log(`Файл: ${dataFile}`)
	console.log(
		`Обновление: ${matches.length} матчей (${leagueId})${ONLY_BROKEN ? ' [только битые]' : ''}\n`,
	)

	const browser = await chromium.launch({
		headless: process.env.HEADLESS !== '0',
		args: ['--no-sandbox'],
	})
	const context = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	})

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

					const payload = {
						score1: match.score1,
						score2: match.score2,
						team1: match.homeTeam,
						team2: match.awayTeam,
					}

					const details = GOALS_ONLY
						? await parseGoalsOnly(page, match.url, payload)
						: await parseMatchFull(page, match.url, payload)

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

					if (!GOALS_ONLY) {
						match.homeLineup = details.homeLineup
						match.awayLineup = details.awayLineup
					}


				} finally {
					await page.close()
				}
			}),
		)

		if (i > 0 && i % 40 === 0) {
			fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8')
		}
		await sleep(200)
	}

	data.meta.goalsRefreshedAt = new Date().toISOString()
	attachCumulativeGoalsToMatches(data.matches)
	fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8')
	await browser.close()
	console.log('\n✅ Готово:', dataFile)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
