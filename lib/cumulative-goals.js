/**
 * Голы в скобках у состава — накопительно по сезону ДО текущего матча
 * (как PPG: только уже сыгранные матчи лиги, в хронологическом порядке).
 */

const { normalizeName, namesMatch, sortLineupByGoals } = require('./match-goals')
const { isBrokenLineup } = require('./lineup-quality')

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

function tallyKey(team, playerName) {
	return `${team}\0${normalizeName(playerName)}`
}

function splitTallyKey(key) {
	const i = key.indexOf('\0')
	if (i < 0) return { team: '', name: key }
	return { team: key.slice(0, i), name: key.slice(i + 1) }
}

function findTallyKey(tally, team, playerName) {
	for (const key of tally.keys()) {
		const { team: t, name } = splitTallyKey(key)
		if (t === team && namesMatch(playerName, name)) return key
	}
	return tallyKey(team, playerName)
}

function getCumulativeCount(tally, team, playerName) {
	const key = findTallyKey(tally, team, playerName)
	return tally.get(key) || 0
}

function addGoalsToTally(tally, team, goalsList) {
	for (const g of goalsList || []) {
		if (!g?.name) continue
		const key = findTallyKey(tally, team, g.name)
		tally.set(key, (tally.get(key) || 0) + 1)
	}
}

function applyCumulativeToLineup(lineup, team, tally, matchGoals) {
	const raw = lineup || []
	if (isBrokenLineup(raw)) {
		return []
	}

	const list = raw
		.map(item => {
			const base =
				typeof item === 'string'
					? { name: String(item).trim(), number: '?' }
					: { ...item }
			if (!base.name) return null
			return {
				...base,
				goals: getCumulativeCount(tally, team, base.name),
			}
		})
		.filter(Boolean)

	for (const g of matchGoals || []) {
		if (!g?.name) continue
		if (list.some(p => namesMatch(p.name, g.name))) continue
		list.push({
			name: g.name.trim(),
			number: '?',
			goals: getCumulativeCount(tally, team, g.name),
		})
	}

	return sortLineupByGoals(list)
}

function attachCumulativeGoalsToMatchList(sortedMatches) {
	const teamTallies = new Map()

	const getTally = team => {
		if (!teamTallies.has(team)) teamTallies.set(team, new Map())
		return teamTallies.get(team)
	}

	for (const match of sortedMatches) {
		const homeTally = getTally(match.homeTeam)
		const awayTally = getTally(match.awayTeam)

		match.homeLineup = applyCumulativeToLineup(
			match.homeLineup,
			match.homeTeam,
			homeTally,
			match.homeGoals,
		)
		match.awayLineup = applyCumulativeToLineup(
			match.awayLineup,
			match.awayTeam,
			awayTally,
			match.awayGoals,
		)

		addGoalsToTally(homeTally, match.homeTeam, match.homeGoals)
		addGoalsToTally(awayTally, match.awayTeam, match.awayGoals)
	}
}

/** По каждой лиге отдельно, матчи по дате */
function attachCumulativeGoalsToMatches(matches) {
	const byLeague = new Map()

	for (const match of matches) {
		const key = match.leagueId || '_default'
		if (!byLeague.has(key)) byLeague.set(key, [])
		byLeague.get(key).push(match)
	}

	for (const leagueMatches of byLeague.values()) {
		const sorted = [...leagueMatches].sort(compareMatches)
		attachCumulativeGoalsToMatchList(sorted)
	}

	return matches
}

module.exports = {
	attachCumulativeGoalsToMatches,
	attachCumulativeGoalsToMatchList,
}
