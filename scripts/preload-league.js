/**
 * Загрузка одной лиги по id из data/leagues.config.json
 *
 * Примеры:
 *   node scripts/preload-league.js eng-premier-2024
 *   $env:LIMIT=5; node scripts/preload-league.js es-laliga-2024
 */
const fs = require('fs')
const path = require('path')
const { loadLeagueData } = require('../lib/livescore')

const CONFIG_PATH = path.join(__dirname, '../data/leagues.config.json')
const LEAGUES_DIR = path.join(__dirname, '../data/leagues')

function loadConfig() {
	return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
}

async function main() {
	const leagueId = process.argv[2] || process.env.LEAGUE_ID
	if (!leagueId) {
		console.error(
			'Укажите id лиги из leagues.config.json, например:\n' +
				'  node scripts/preload-league.js eng-premier-2024\n',
		)
		process.exit(1)
	}

	const config = loadConfig()
	const entry = config.leagues.find(l => l.id === leagueId)
	if (!entry) {
		console.error(`Лига "${leagueId}" не найдена в ${CONFIG_PATH}`)
		process.exit(1)
	}

	const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0
	const headless = process.env.HEADLESS !== '0'

	console.log(`⚽ ${entry.leagueLabel} (${entry.season})\n`)

	const data = await loadLeagueData({
		leagueId: entry.id,
		seasonUrl: entry.seasonUrl,
		leagueLabel: entry.leagueLabel,
		country: entry.country,
		league: entry.league,
		season: entry.season,
		concurrent: parseInt(process.env.CONCURRENT || '4', 10),
		headless,
		limit,
	})

	if (limit > 0) data.meta.limited = limit

	if (!fs.existsSync(LEAGUES_DIR)) fs.mkdirSync(LEAGUES_DIR, { recursive: true })
	const output = path.join(LEAGUES_DIR, `${entry.id}.json`)
	fs.writeFileSync(output, JSON.stringify(data, null, 2), 'utf8')

	console.log(`\n✅ Сохранено: ${output}`)
	console.log(`   Матчей: ${data.matches.length}`)
}

main().catch(err => {
	console.error('Ошибка:', err)
	process.exit(1)
})
