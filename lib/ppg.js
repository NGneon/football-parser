/**
 * PPG перед матчем: только уже сыгранные игры сезона (в хронологическом порядке).
 * TT — итог матча; H/A — домашние/гостевые очки; H/T и S/T — по таймам.
 */

const { applyOwnGoalsToMatch } = require('./own-goals-score')

function parseMatchDate(str) {
	if (!str) return 0
	const [d, m, y] = str.split('.').map(Number)
	return new Date(y, m - 1, d).getTime()
}

function compareMatches(a, b) {
	const da = parseMatchDate(a.date)
	const db = parseMatchDate(b.date)
	if (da !== db) return da - db
	return String(a.id || '').localeCompare(String(b.id || ''))
}

function pointsFromScores(homeTeam, awayTeam, homeScore, awayScore, teamName) {
	const isHome = teamName === homeTeam
	const gf = isHome ? homeScore : awayScore
	const ga = isHome ? awayScore : homeScore
	if (gf > ga) return 3
	if (gf === ga) return 1
	return 0
}

function getHalfScores(match) {
	if (
		match.firstHalfHome != null &&
		match.firstHalfAway != null &&
		match.secondHalfHome != null &&
		match.secondHalfAway != null
	) {
		return {
			htH: match.firstHalfHome,
			htA: match.firstHalfAway,
			stH: match.secondHalfHome,
			stA: match.secondHalfAway,
		}
	}
	const parsed = match.scoreDisplay?.match(
		/\((\d+)-(\d+)\)\s+(\d+)-(\d+)\s+\|\s+(\d+)-(\d+)/,
	)
	if (parsed) {
		const parenH = +parsed[1]
		const parenA = +parsed[2]
		const midH = +parsed[3]
		const midA = +parsed[4]
		const stH = +parsed[5]
		const stA = +parsed[6]
		if (parenH === match.score1 && parenA === match.score2) {
			return { htH: midH, htA: midA, stH, stA }
		}
		if (midH === match.score1 && midA === match.score2) {
			return { htH: parenH, htA: parenA, stH, stA }
		}
	}
	return {
		htH: 0,
		htA: 0,
		stH: Math.max(0, match.score1),
		stA: Math.max(0, match.score2),
	}
}

function createTeamStats() {
	return {
		tt: { points: 0, games: 0 },
		homeVenue: { points: 0, games: 0 },
		awayVenue: { points: 0, games: 0 },
		ht: { points: 0, games: 0 },
		st: { points: 0, games: 0 },
	}
}

function formatPpgValue(ppg) {
	if (ppg === 0) return '0'
	return Number(ppg.toFixed(5)).toString()
}

function calcPpg(points, games) {
	if (games === 0) return 0
	return points / games
}

function buildPpgRow(homeStats, awayStats, type) {
	const homeVal = calcPpg(homeStats[type].points, homeStats[type].games)
	const awayVal = calcPpg(awayStats[type].points, awayStats[type].games)
	const gap = Math.abs(homeVal - awayVal)
	return {
		home: formatPpgValue(homeVal),
		away: formatPpgValue(awayVal),
		gap: formatPpgValue(gap),
		gapNum: gap,
	}
}

/** H/A: домашняя PPG хозяев vs гостевая PPG гостей */
function buildPpgHaRow(homeStats, awayStats) {
	const homeVal = calcPpg(
		homeStats.homeVenue.points,
		homeStats.homeVenue.games,
	)
	const awayVal = calcPpg(
		awayStats.awayVenue.points,
		awayStats.awayVenue.games,
	)
	const gap = Math.abs(homeVal - awayVal)
	return {
		home: formatPpgValue(homeVal),
		away: formatPpgValue(awayVal),
		gap: formatPpgValue(gap),
		gapNum: gap,
	}
}

function recordResult(stats, match) {
	const m = { ...match }
	applyOwnGoalsToMatch(m)

	const { homeTeam, awayTeam, score1, score2 } = m
	const halves = getHalfScores(m)

	const homePts = pointsFromScores(homeTeam, awayTeam, score1, score2, homeTeam)
	const awayPts = pointsFromScores(homeTeam, awayTeam, score1, score2, awayTeam)
	const homeHtPts = pointsFromScores(
		homeTeam,
		awayTeam,
		halves.htH,
		halves.htA,
		homeTeam,
	)
	const awayHtPts = pointsFromScores(
		homeTeam,
		awayTeam,
		halves.htH,
		halves.htA,
		awayTeam,
	)
	const homeStPts = pointsFromScores(
		homeTeam,
		awayTeam,
		halves.stH,
		halves.stA,
		homeTeam,
	)
	const awayStPts = pointsFromScores(
		homeTeam,
		awayTeam,
		halves.stH,
		halves.stA,
		awayTeam,
	)

	const home = stats.get(homeTeam)
	const away = stats.get(awayTeam)

	home.tt.points += homePts
	home.tt.games += 1
	home.homeVenue.points += homePts
	home.homeVenue.games += 1
	home.ht.points += homeHtPts
	home.ht.games += 1
	home.st.points += homeStPts
	home.st.games += 1

	away.tt.points += awayPts
	away.tt.games += 1
	away.awayVenue.points += awayPts
	away.awayVenue.games += 1
	away.ht.points += awayHtPts
	away.ht.games += 1
	away.st.points += awayStPts
	away.st.games += 1
}

function assignTourNumbers(matches, matchesPerTour = 10) {
	let tour = 1
	let count = 0
	for (const match of matches) {
		match.tour = tour
		count += 1
		if (count >= matchesPerTour) {
			tour += 1
			count = 0
		}
	}
}

function attachPpgToMatchList(matches) {
	const stats = new Map()

	const ensure = name => {
		if (!stats.has(name)) stats.set(name, createTeamStats())
	}

	for (const match of matches) {
		if (match.status && match.status !== 'finished') {
			match.ppg = {
				tt: { home: '—', away: '—', gap: '—', gapNum: 0 },
				ha: { home: '—', away: '—', gap: '—', gapNum: 0 },
				ht: { home: '—', away: '—', gap: '—', gapNum: 0 },
				st: { home: '—', away: '—', gap: '—', gapNum: 0 },
			}
			continue
		}

		ensure(match.homeTeam)
		ensure(match.awayTeam)

		const homeStats = stats.get(match.homeTeam)
		const awayStats = stats.get(match.awayTeam)

		match.ppg = {
			tt: buildPpgRow(homeStats, awayStats, 'tt'),
			ha: buildPpgHaRow(homeStats, awayStats),
			ht: buildPpgRow(homeStats, awayStats, 'ht'),
			st: buildPpgRow(homeStats, awayStats, 'st'),
		}

		recordResult(stats, match)
	}
}

function attachPpgToMatches(matches) {
	const byLeague = new Map()

	for (const match of matches) {
		const key = match.leagueId || '_default'
		if (!byLeague.has(key)) byLeague.set(key, [])
		byLeague.get(key).push(match)
	}

	for (const leagueMatches of byLeague.values()) {
		const sorted = [...leagueMatches].sort(compareMatches)
		assignTourNumbers(sorted)
		attachPpgToMatchList(sorted)
	}

	return matches
}

module.exports = {
	attachPpgToMatches,
	assignTourNumbers,
	parseMatchDate,
	formatPpgValue,
}
