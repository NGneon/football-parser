/**
 * Пересчёт накопительных голов в скобках из уже сохранённых homeGoals/awayGoals.
 * Без повторного парсинга сайта.
 */
const fs = require('fs')
const path = require('path')
const { attachCumulativeGoalsToMatches } = require('../lib/cumulative-goals')

const DATA_DIR = path.join(__dirname, '../data')
const LEAGUES_DIR = path.join(DATA_DIR, 'leagues')
const LEGACY = path.join(DATA_DIR, 'premier-league-2024-2025.json')

function processFile(filePath) {
	const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
	attachCumulativeGoalsToMatches(data.matches)
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
	const withGoals = data.matches.filter(
		m => m.homeGoals?.length || m.awayGoals?.length,
	).length
	console.log(
		`✅ ${path.basename(filePath)} — ${data.matches.length} матчей, с голами в JSON: ${withGoals}`,
	)
}

function main() {
	const files = []
	if (fs.existsSync(LEGACY)) files.push(LEGACY)
	if (fs.existsSync(LEAGUES_DIR)) {
		for (const name of fs.readdirSync(LEAGUES_DIR)) {
			if (name.endsWith('.json')) files.push(path.join(LEAGUES_DIR, name))
		}
	}
	if (!files.length) {
		console.log('Нет JSON с матчами')
		return
	}
	for (const f of files) processFile(f)
}

main()
