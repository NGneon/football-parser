/**
 * @deprecated Используйте lib/cumulative-goals.js (накопительно после матча).
 */
const { attachCumulativeGoalsToMatches } = require('./cumulative-goals')

function attachLineupMatchGoals(matches) {
	return attachCumulativeGoalsToMatches(matches)
}

module.exports = { attachLineupMatchGoals, attachCumulativeGoalsToMatches }
