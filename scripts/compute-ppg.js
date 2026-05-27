/**
 * Пересчитывает PPG (TT) и PPG (H/A) в уже сохранённых JSON лиг.
 */
const fs = require('fs')
const path = require('path')
const { attachPpgToMatches } = require('../lib/ppg')
const { attachCumulativeGoalsToMatches } = require('../lib/cumulative-goals')

const DATA_DIR = path.join(__dirname, '../data')
const LEAGUES_DIR = path.join(DATA_DIR, 'leagues')
const LEGACY = path.join(DATA_DIR, 'premier-league-2024-2025.json')

function processFile(filePath) {
	const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
	attachCumulativeGoalsToMatches(data.matches)
	attachPpgToMatches(data.matches)
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
	console.log(`✅ ${path.basename(filePath)} — ${data.matches.length} матчей`)
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
