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

module.exports = {
	isBadPlayer,
	isBrokenLineup,
	isBrokenMatch,
	MIN_SQUAD,
}
