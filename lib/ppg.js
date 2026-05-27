/**
 * PPG перед матчем: только уже сыгранные игры сезона (в хронологическом порядке).
 * TT / H/A — по итоговому счёту; H/T / S/T — по 1-му и 2-му тайму.
 */

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
		home: { points: 0, games: 0 },
		ht: { points: 0, games: 0 },
		st: { points: 0, games: 0 },
		homeHt: { points: 0, games: 0 },
		homeSt: { points: 0, games: 0 },
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

function recordResult(stats, match) {
	const { homeTeam, awayTeam, score1, score2 } = match
	const halves = getHalfScores(match)

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
	home.home.points += homePts
	home.home.games += 1
	home.ht.points += homeHtPts
	home.ht.games += 1
	home.st.points += homeStPts
	home.st.games += 1
	home.homeHt.points += homeHtPts
	home.homeHt.games += 1
	home.homeSt.points += homeStPts
	home.homeSt.games += 1

	away.tt.points += awayPts
	away.tt.games += 1
	away.ht.points += awayHtPts
	away.ht.games += 1
	away.st.points += awayStPts
	away.st.games += 1
}

/** Номер тура: 10 матчей на тур (20 команд) */
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
		ensure(match.homeTeam)
		ensure(match.awayTeam)

		const homeStats = stats.get(match.homeTeam)
		const awayStats = stats.get(match.awayTeam)

		match.ppg = {
			tt: buildPpgRow(homeStats, awayStats, 'tt'),
			ha: buildPpgRow(homeStats, awayStats, 'home'),
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
