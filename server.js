const express = require('express')
const fs = require('fs')
const path = require('path')
const { attachPpgToMatches } = require('./lib/ppg')
const { attachCumulativeGoalsToMatches } = require('./lib/cumulative-goals')
const { sortMatchesByLeagueOrder } = require('./lib/match-order')

const app = express()
const PORT = process.env.PORT || 3000
const CONFIG_PATH = path.join(__dirname, 'data/leagues.config.json')
const LEAGUES_DIR = path.join(__dirname, 'data/leagues')
const LEGACY_FILE = path.join(__dirname, 'data/premier-league-2024-2025.json')

app.use(express.static(path.join(__dirname, 'public')))

function loadLeaguesConfig() {
	if (!fs.existsSync(CONFIG_PATH)) {
		return { leagues: [] }
	}
	return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
}

function readLeagueFile(filePath) {
	if (!fs.existsSync(filePath)) return null
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'))
	} catch {
		return null
	}
}

/** Все загруженные файлы лиг (data/leagues/*.json + legacy) */
function loadAllLeagueFiles() {
	const files = []

	if (fs.existsSync(LEAGUES_DIR)) {
		for (const name of fs.readdirSync(LEAGUES_DIR)) {
			if (!name.endsWith('.json')) continue
			const data = readLeagueFile(path.join(LEAGUES_DIR, name))
			if (data?.matches) files.push(data)
		}
	}

	const legacy = readLeagueFile(LEGACY_FILE)
	if (legacy?.matches?.length) {
		const legacyId = legacy.meta?.leagueId || 'eng-premier-2024'
		legacy.meta = { ...legacy.meta, leagueId: legacyId }
		const hasLegacy = files.some(f => f.meta?.leagueId === legacyId)
		if (!hasLegacy) files.push(legacy)
	}

	return files
}

function buildTree(config, loadedFiles) {
	const loadedIds = new Set(
		loadedFiles.map(f => f.meta?.leagueId).filter(Boolean),
	)
	const byCountry = new Map()

	for (const entry of config.leagues || []) {
		if (!byCountry.has(entry.country)) {
			byCountry.set(entry.country, {
				country: entry.country,
				leagueGroups: new Map(),
			})
		}
		const countryNode = byCountry.get(entry.country)
		const groupKey = entry.league
		if (!countryNode.leagueGroups.has(groupKey)) {
			countryNode.leagueGroups.set(groupKey, {
				name: entry.league,
				leagueLabel: entry.leagueLabel,
				seasons: [],
			})
		}
		countryNode.leagueGroups.get(groupKey).seasons.push({
			id: entry.id,
			season: entry.season,
			loaded: loadedIds.has(entry.id),
			enabled: !!entry.enabled,
		})
	}

	return [...byCountry.values()].map(c => ({
		country: c.country,
		leagues: [...c.leagueGroups.values()].map(g => ({
			name: g.name,
			leagueLabel: g.leagueLabel,
			seasons: g.seasons.sort((a, b) =>
				String(b.season).localeCompare(String(a.season)),
			),
		})),
	}))
}

function mergeMatches(loadedFiles, leagueIds) {
	const ids = leagueIds?.length ? new Set(leagueIds) : null
	const matches = []

	for (const file of loadedFiles) {
		const fileId = file.meta?.leagueId
		if (ids && fileId && !ids.has(fileId)) continue
		if (ids && !fileId) continue

		for (const m of file.matches) {
			const row = {
				...m,
				leagueId: m.leagueId || fileId,
				country: m.country || file.meta?.country,
				league: m.league || file.meta?.league,
				leagueLabel:
					m.leagueLabel ||
					file.meta?.leagueLabel ||
					`${file.meta?.country}: ${file.meta?.league}`,
			}
			matches.push(row)
		}
	}

	const ordered = leagueIds?.length
		? sortMatchesByLeagueOrder(matches, leagueIds)
		: sortMatchesByLeagueOrder(
				matches,
				[...new Set(matches.map(m => m.leagueId).filter(Boolean))],
			)
	matches.length = 0
	matches.push(...ordered)

	attachCumulativeGoalsToMatches(matches)
	attachPpgToMatches(matches)
	return matches
}

app.get('/api/config', (req, res) => {
	res.json(loadLeaguesConfig())
})

app.get('/api/tree', (req, res) => {
	const config = loadLeaguesConfig()
	const loaded = loadAllLeagueFiles()
	res.json({
		tree: buildTree(config, loaded),
		loadedLeagueIds: loaded.map(f => f.meta?.leagueId).filter(Boolean),
	})
})

app.get('/api/league', (req, res) => {
	const loaded = loadAllLeagueFiles()
	const leagueIds = req.query.leagues
		? req.query.leagues.split(',').filter(Boolean)
		: loaded.map(f => f.meta?.leagueId).filter(Boolean)

	const matches = mergeMatches(loaded, leagueIds)
	const config = loadLeaguesConfig()

	res.json({
		meta: {
			leagueCount: loaded.length,
			matchCount: matches.length,
			loadedLeagueIds: leagueIds,
		},
		tree: buildTree(config, loaded),
		matches,
	})
})

app.get('/api/matches', (req, res) => {
	const loaded = loadAllLeagueFiles()
	const leagueIds = req.query.leagues
		? req.query.leagues.split(',').filter(Boolean)
		: null

	let matches = mergeMatches(loaded, leagueIds)

	if (req.query.date) {
		matches = matches.filter(m => m.date === req.query.date)
	}

	res.json({ matches })
})

app.get('/api/dates', (req, res) => {
	const loaded = loadAllLeagueFiles()
	const leagueIds = req.query.leagues
		? req.query.leagues.split(',').filter(Boolean)
		: null

	const matches = mergeMatches(loaded, leagueIds)
	const dates = [...new Set(matches.map(m => m.date).filter(Boolean))]

	res.json(
		dates.sort((a, b) => {
			const [da, ma, ya] = a.split('.').map(Number)
			const [db, mb, yb] = b.split('.').map(Number)
			return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db)
		}),
	)
})

const server = app.listen(PORT, () => {
	console.log(`\n🌐 Веб-интерфейс: http://localhost:${PORT}`)
	const loaded = loadAllLeagueFiles()
	const total = loaded.reduce((n, f) => n + (f.matches?.length || 0), 0)
	if (!total) {
		console.log(
			'⚠️  Данные не загружены. См. data/leagues.config.json и:\n' +
				'   npm run preload-league -- eng-premier-2024\n',
		)
	} else {
		console.log(`   Лиг в базе: ${loaded.length}, матчей: ${total}\n`)
	}
})

server.on('error', err => {
	if (err.code === 'EADDRINUSE') {
		console.error(
			`\n❌ Порт ${PORT} уже занят.\n` +
				`   $env:PORT=3001; npm run web\n`,
		)
		process.exit(1)
	}
	throw err
})
