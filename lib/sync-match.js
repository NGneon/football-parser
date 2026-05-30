/**
 * Синхронизация одного матча (для незавершённых / обновления)
 */
const { chromium } = require('playwright')
const { parseMatchFull } = require('./livescore')
const { attachCumulativeGoalsToMatches } = require('./cumulative-goals')
const { attachPpgToMatches } = require('./ppg')
const { detectStatusFromList } = require('./match-status')

async function syncSingleMatch(match) {
	const browser = await chromium.launch({
		headless: process.env.HEADLESS !== '0',
		args: ['--no-sandbox'],
	})
	const page = await browser.newPage()
	try {
		const payload = {
			score1: match.score1,
			score2: match.score2,
			team1: match.homeTeam,
			team2: match.awayTeam,
			matchTime: match.time,
			statusStage: '',
			scoreFinished: match.status === 'finished',
		}

		const details = match.url
			? await parseMatchFull(page, match.url, payload)
			: null

		if (details?.skippedBracket) {
			return { ok: false, error: 'Матч в сетке плей-офф — не парсится' }
		}

		const status = details?.status || detectStatusFromList(payload)
		const updated = {
			...match,
			status,
			parseSkipped: details?.parseSkipped || false,
			firstHalfHome: details?.firstHalfHome ?? match.firstHalfHome,
			firstHalfAway: details?.firstHalfAway ?? match.firstHalfAway,
			secondHalfHome: details?.secondHalfHome ?? match.secondHalfHome,
			secondHalfAway: details?.secondHalfAway ?? match.secondHalfAway,
			homeGoals: details?.homeGoals ?? match.homeGoals,
			awayGoals: details?.awayGoals ?? match.awayGoals,
			ownGoals: details?.ownGoals ?? match.ownGoals,
			homeLineup: details?.homeLineup ?? match.homeLineup,
			awayLineup: details?.awayLineup ?? match.awayLineup,
		}

		const ht = `${updated.firstHalfHome}-${updated.firstHalfAway}`
		const ft = `${updated.score1}-${updated.score2}`
		const st = `${updated.secondHalfHome}-${updated.secondHalfAway}`
		updated.scoreDisplay =
			status === 'finished' ? `(${ft}) ${ht} | ${st}` : ft

		const list = [updated]
		attachCumulativeGoalsToMatches(list)
		attachPpgToMatches(list)

		return { ok: true, match: list[0] }
	} finally {
		await browser.close()
	}
}

module.exports = { syncSingleMatch }
