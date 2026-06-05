/** Проверка состава (полный состав: старт + запасные) */

const COACH_RE = /тренер|coach|manager/i
const MIN_SQUAD = 7

function isBadPlayer(p) {
	if (!p?.name || p.name === '—') return true
	if (COACH_RE.test(p.name)) return true
	if (/^\d+$/.test(String(p.name).trim())) return true
	return false
}

function isBrokenLineup(lineup) {
	if (!lineup?.length) return true
	const valid = lineup.filter(p => !isBadPlayer(p))
	if (valid.length < MIN_SQUAD) return true
	return false
}

function isBrokenMatch(m) {
	if (!m?.url) return false
	if (m.skippedBracket) return false
	if (isBrokenLineup(m.homeLineup) || isBrokenLineup(m.awayLineup)) return true
	if (
		m.status === 'finished' &&
		(m.score1 > 0 || m.score2 > 0) &&
		!(m.homeGoals?.length || m.awayGoals?.length)
	) {
		return true
	}
	return false
}

function isIncompleteSquad(lineup) {
	if (isBrokenLineup(lineup)) return true
	const valid = (lineup || []).filter(p => !isBadPlayer(p))
	const subs = valid.filter(p => p.role === 'sub')
	if (subs.length >= 3) return false
	if (valid.length >= 15) return false
	return true
}

function isIncompleteMatch(m) {
	if (!m?.url) return false
	if (m.skippedBracket) return false
	if (isIncompleteSquad(m.homeLineup) || isIncompleteSquad(m.awayLineup)) {
		return true
	}
	if (
		m.status === 'finished' &&
		(m.score1 > 0 || m.score2 > 0) &&
		!(m.homeGoals?.length || m.awayGoals?.length)
	) {
		return true
	}
	return false
}

module.exports = {
	isBadPlayer,
	isBrokenLineup,
	isBrokenMatch,
	isIncompleteSquad,
	isIncompleteMatch,
	MIN_SQUAD,
}
