/**
 * Автогол учитывается в счёте и таймах (для PPG), в UI не показывается.
 */

function applyOwnGoalsToHalves(match) {
	for (const og of match.ownGoals || []) {
		const half = og.half === 1 ? 'first' : 'second'
		if (og.team === 'home') {
			if (half === 'first') match.firstHalfAway = (match.firstHalfAway || 0) + 1
			else match.secondHalfAway = (match.secondHalfAway || 0) + 1
		} else {
			if (half === 'first') match.firstHalfHome = (match.firstHalfHome || 0) + 1
			else match.secondHalfHome = (match.secondHalfHome || 0) + 1
		}
	}
}

function reconcileHalfTotals(match) {
	const fh = (match.firstHalfHome || 0) + (match.firstHalfAway || 0)
	const sh =
		(match.secondHalfHome || 0) + (match.secondHalfAway || 0)
	const ft = (match.score1 || 0) + (match.score2 || 0)

	if (ft > 0 && fh + sh === 0) {
		match.secondHalfHome = match.score1
		match.secondHalfAway = match.score2
		return
	}

	if (ft > 0 && fh + sh !== ft) {
		const diff = ft - (fh + sh)
		if (diff > 0) {
			if ((match.secondHalfHome || 0) + (match.secondHalfAway || 0) === 0) {
				match.secondHalfHome = match.score1 - (match.firstHalfHome || 0)
				match.secondHalfAway = match.score2 - (match.firstHalfAway || 0)
			}
		}
	}
}

function applyOwnGoalsToMatch(match) {
	applyOwnGoalsToHalves(match)
	reconcileHalfTotals(match)
	return match
}

module.exports = {
	applyOwnGoalsToMatch,
	applyOwnGoalsToHalves,
}
