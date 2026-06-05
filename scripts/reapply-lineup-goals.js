/**
 * Пересчитать накопительные голы в составах (после матча) для всех JSON.
 *
 *   npm run reapply-goals
 */
const fs = require('fs')
const path = require('path')
const { attachCumulativeGoalsToMatches } = require('../lib/cumulative-goals')
const { attachPpgToMatches } = require('../lib/ppg')
const { importLeagueData, isDbEnabled, requireDb, initSchema } = require('../lib/db')

const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const LEGACY = path.join(__dirname, '../data/premier-league-2024-2025.json')

function processFile(filePath) {
	const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
	if (!data.matches?.length) return 0
	attachCumulativeGoalsToMatches(data.matches)
	attachPpgToMatches(data.matches)
	data.meta = data.meta || {}
	data.meta.lineupGoalsMode = 'cumulative_before_match'
	data.meta.lineupGoalsUpdatedAt = new Date().toISOString()
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
	if (isDbEnabled()) {
		const db = requireDb()
		initSchema(db)
		importLeagueData(db, data)
		db.close()
	}
	return data.matches.length
}

let total = 0
let files = 0

if (fs.existsSync(LEAGUES_DIR)) {
	for (const name of fs.readdirSync(LEAGUES_DIR)) {
		if (!name.endsWith('.json')) continue
		const n = processFile(path.join(LEAGUES_DIR, name))
		console.log(`✓ ${name} — ${n} матчей`)
		total += n
		files++
	}
}

if (fs.existsSync(LEGACY)) {
	const n = processFile(LEGACY)
	console.log(`✓ premier-league (legacy) — ${n} матчей`)
	total += n
	files++
}

console.log(`\n✅ Обновлено: ${files} файлов, ${total} матчей (голы перед матчем)`)
