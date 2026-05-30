/**
 * SQLite-хранилище лиг и матчей (один файл .db для передачи другому пользователю)
 */
const fs = require('fs')
const path = require('path')

const DEFAULT_DB = path.join(__dirname, '../data/football.db')
const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const LEGACY_FILE = path.join(__dirname, '../data/premier-league-2024-2025.json')

let Database
try {
	Database = require('better-sqlite3')
} catch {
	Database = null
}

function getDbPath() {
	return process.env.DB_PATH || DEFAULT_DB
}

function requireDb() {
	if (!Database) {
		throw new Error(
			'Установите better-sqlite3: npm install better-sqlite3',
		)
	}
	const dbPath = getDbPath()
	fs.mkdirSync(path.dirname(dbPath), { recursive: true })
	const db = new Database(dbPath)
	db.pragma('journal_mode = WAL')
	db.pragma('foreign_keys = ON')
	return db
}

function initSchema(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS leagues (
			id TEXT PRIMARY KEY,
			country TEXT,
			league TEXT,
			season TEXT,
			league_label TEXT,
			season_url TEXT,
			loaded_at TEXT
		);

		CREATE TABLE IF NOT EXISTS matches (
			id TEXT PRIMARY KEY,
			league_id TEXT NOT NULL,
			round TEXT,
			date TEXT,
			time TEXT,
			home_team TEXT,
			away_team TEXT,
			score1 INTEGER DEFAULT 0,
			score2 INTEGER DEFAULT 0,
			score_display TEXT,
			first_half_home INTEGER DEFAULT 0,
			first_half_away INTEGER DEFAULT 0,
			second_half_home INTEGER DEFAULT 0,
			second_half_away INTEGER DEFAULT 0,
			url TEXT,
			tour INTEGER,
			status TEXT DEFAULT 'finished',
			parse_skipped INTEGER DEFAULT 0,
			skipped_bracket INTEGER DEFAULT 0,
			home_goals_json TEXT,
			away_goals_json TEXT,
			own_goals_json TEXT,
			ppg_json TEXT,
			FOREIGN KEY (league_id) REFERENCES leagues(id)
		);

		CREATE TABLE IF NOT EXISTS lineup_players (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			match_id TEXT NOT NULL,
			side TEXT NOT NULL,
			name TEXT NOT NULL,
			number TEXT,
			goals INTEGER DEFAULT 0,
			role TEXT,
			sort_order INTEGER DEFAULT 0,
			FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_matches_league ON matches(league_id);
		CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
		CREATE INDEX IF NOT EXISTS idx_lineup_match ON lineup_players(match_id);
	`)
}

function readJsonFile(filePath) {
	if (!fs.existsSync(filePath)) return null
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'))
	} catch {
		return null
	}
}

function importLeagueData(db, data) {
	const meta = data.meta || {}
	const leagueId = meta.leagueId
	if (!leagueId) return 0

	const insertLeague = db.prepare(`
		INSERT INTO leagues (id, country, league, season, league_label, season_url, loaded_at)
		VALUES (@id, @country, @league, @season, @league_label, @season_url, @loaded_at)
		ON CONFLICT(id) DO UPDATE SET
			country=excluded.country,
			league=excluded.league,
			season=excluded.season,
			league_label=excluded.league_label,
			season_url=excluded.season_url,
			loaded_at=excluded.loaded_at
	`)

	const deleteMatch = db.prepare('DELETE FROM matches WHERE league_id = ?')
	const insertMatch = db.prepare(`
		INSERT INTO matches (
			id, league_id, round, date, time, home_team, away_team,
			score1, score2, score_display,
			first_half_home, first_half_away, second_half_home, second_half_away,
			url, tour, status, parse_skipped, skipped_bracket,
			home_goals_json, away_goals_json, own_goals_json, ppg_json
		) VALUES (
			@id, @league_id, @round, @date, @time, @home_team, @away_team,
			@score1, @score2, @score_display,
			@first_half_home, @first_half_away, @second_half_home, @second_half_away,
			@url, @tour, @status, @parse_skipped, @skipped_bracket,
			@home_goals_json, @away_goals_json, @own_goals_json, @ppg_json
		)
	`)

	const deleteLineup = db.prepare(
		'DELETE FROM lineup_players WHERE match_id = ?',
	)
	const insertPlayer = db.prepare(`
		INSERT INTO lineup_players (match_id, side, name, number, goals, role, sort_order)
		VALUES (@match_id, @side, @name, @number, @goals, @role, @sort_order)
	`)

	insertLeague.run({
		id: leagueId,
		country: meta.country || '',
		league: meta.league || '',
		season: meta.season || '',
		league_label: meta.leagueLabel || '',
		season_url: meta.seasonUrl || '',
		loaded_at: meta.loadedAt || new Date().toISOString(),
	})

	deleteMatch.run(leagueId)

	let count = 0
	const tx = db.transaction(() => {
		for (const m of data.matches || []) {
			const matchId = m.id
			if (!matchId) continue

			insertMatch.run({
				id: matchId,
				league_id: leagueId,
				round: m.round || '',
				date: m.date || '',
				time: m.time || '',
				home_team: m.homeTeam || '',
				away_team: m.awayTeam || '',
				score1: m.score1 || 0,
				score2: m.score2 || 0,
				score_display: m.scoreDisplay || '',
				first_half_home: m.firstHalfHome || 0,
				first_half_away: m.firstHalfAway || 0,
				second_half_home: m.secondHalfHome || 0,
				second_half_away: m.secondHalfAway || 0,
				url: m.url || '',
				tour: m.tour || null,
				status: m.status || 'finished',
				parse_skipped: m.parseSkipped ? 1 : 0,
				skipped_bracket: m.skippedBracket ? 1 : 0,
				home_goals_json: JSON.stringify(m.homeGoals || []),
				away_goals_json: JSON.stringify(m.awayGoals || []),
				own_goals_json: JSON.stringify(m.ownGoals || []),
				ppg_json: JSON.stringify(m.ppg || {}),
			})

			deleteLineup.run(matchId)

			;(m.homeLineup || []).forEach((p, i) => {
				insertPlayer.run({
					match_id: matchId,
					side: 'home',
					name: p.name,
					number: p.number || '?',
					goals: p.goals != null ? p.goals : 0,
					role: p.role || 'starter',
					sort_order: i,
				})
			})
			;(m.awayLineup || []).forEach((p, i) => {
				insertPlayer.run({
					match_id: matchId,
					side: 'away',
					name: p.name,
					number: p.number || '?',
					goals: p.goals != null ? p.goals : 0,
					role: p.role || 'starter',
					sort_order: i,
				})
			})

			count++
		}
	})
	tx()
	return count
}

function importAllJsonToDb(dbPath) {
	const db = requireDb()
	initSchema(db)

	const files = []
	if (fs.existsSync(LEAGUES_DIR)) {
		for (const name of fs.readdirSync(LEAGUES_DIR)) {
			if (name.endsWith('.json')) {
				files.push(path.join(LEAGUES_DIR, name))
			}
		}
	}
	if (fs.existsSync(LEGACY_FILE)) files.push(LEGACY_FILE)

	let leagues = 0
	let matches = 0
	for (const file of files) {
		const data = readJsonFile(file)
		if (!data?.matches?.length) continue
		matches += importLeagueData(db, data)
		leagues++
	}

	db.close()
	return { dbPath: dbPath || getDbPath(), leagues, matches }
}

function rowToMatch(row, lineupsByMatch) {
	const homeLineup = lineupsByMatch?.get(`${row.id}:home`) || []
	const awayLineup = lineupsByMatch?.get(`${row.id}:away`) || []
	return {
		id: row.id,
		leagueId: row.league_id,
		country: row.country,
		league: row.league,
		leagueLabel: row.league_label,
		round: row.round,
		date: row.date,
		time: row.time,
		homeTeam: row.home_team,
		awayTeam: row.away_team,
		score1: row.score1,
		score2: row.score2,
		scoreDisplay: row.score_display,
		firstHalfHome: row.first_half_home,
		firstHalfAway: row.first_half_away,
		secondHalfHome: row.second_half_home,
		secondHalfAway: row.second_half_away,
		url: row.url,
		tour: row.tour,
		status: row.status,
		parseSkipped: !!row.parse_skipped,
		skippedBracket: !!row.skipped_bracket,
		homeGoals: JSON.parse(row.home_goals_json || '[]'),
		awayGoals: JSON.parse(row.away_goals_json || '[]'),
		ownGoals: JSON.parse(row.own_goals_json || '[]'),
		ppg: JSON.parse(row.ppg_json || '{}'),
		homeLineup,
		awayLineup,
	}
}

function loadAllFromDb() {
	const dbPath = getDbPath()
	if (!Database || !fs.existsSync(dbPath)) return []

	const db = requireDb()
	initSchema(db)

	const leagues = db
		.prepare('SELECT * FROM leagues ORDER BY country, league')
		.all()

	const result = []
	for (const lg of leagues) {
		const matchRows = db
			.prepare(
				`SELECT m.*, l.country, l.league, l.league_label
				 FROM matches m
				 JOIN leagues l ON l.id = m.league_id
				 WHERE m.league_id = ?
				 ORDER BY m.date, m.id`,
			)
			.all(lg.id)

		const lineups = db
			.prepare(
				'SELECT * FROM lineup_players WHERE match_id IN (SELECT id FROM matches WHERE league_id = ?) ORDER BY sort_order',
			)
			.all(lg.id)

		const lineupsByMatch = new Map()
		for (const p of lineups) {
			const key = `${p.match_id}:${p.side}`
			if (!lineupsByMatch.has(key)) lineupsByMatch.set(key, [])
			lineupsByMatch.get(key).push({
				name: p.name,
				number: p.number,
				goals: p.goals,
				role: p.role,
			})
		}

		const matches = matchRows.map(r => rowToMatch(r, lineupsByMatch))
		result.push({
			meta: {
				leagueId: lg.id,
				country: lg.country,
				league: lg.league,
				season: lg.season,
				leagueLabel: lg.league_label,
				seasonUrl: lg.season_url,
				loadedAt: lg.loaded_at,
				matchCount: matches.length,
			},
			matches,
		})
	}

	db.close()
	return result
}

function isDbEnabled() {
	if (process.env.USE_DB === '0') return false
	if (process.env.USE_DB === '1') return true
	return fs.existsSync(getDbPath())
}

module.exports = {
	getDbPath,
	requireDb,
	initSchema,
	importLeagueData,
	importAllJsonToDb,
	loadAllFromDb,
	isDbEnabled,
}
