/** Проверка полноты состава (11 стартовых) */

const COACH_RE = /тренер|coach|manager/i

function isBadPlayer(p) {
	if (!p?.name || p.name === '—') return true
	if (COACH_RE.test(p.name)) return true
	if (/^\d+$/.test(String(p.name).trim())) return true
	return false
}

function isBrokenLineup(lineup) {
	if (!lineup?.length) return true
	if (lineup.length < 11) return true
	if (lineup.some(isBadPlayer)) return true
	return false
}

function isBrokenMatch(m) {
	if (!m?.url) return false
	if (isBrokenLineup(m.homeLineup) || isBrokenLineup(m.awayLineup)) return true
	if (
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
	STARTING_XI: 11,
}
