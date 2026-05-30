const { chromium } = require('playwright')
const { attachPpgToMatches } = require('./ppg')
const { parseGoalsInPage } = require('./match-goals')
const { attachCumulativeGoalsToMatches } = require('./cumulative-goals')
const {
	buildSummaryUrl,
	fetchLineups,
	fetchLineupsOnCurrentPage,
	hasUsableLineup,
} = require('./lineups')
const { hasBracketTabInPage } = require('./match-page')
const { applyOwnGoalsToMatch } = require('./own-goals-score')
const { detectStatusFromList } = require('./match-status')

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function clickShowMoreButton(page) {
	const selectors = [
		'button.wcl-footer__button_OauhJ',
		'button[data-testid="wcl-buttonLink"]',
		'button:has-text("Показать больше матчей")',
		'button:has-text("Show more")',
	]

	for (const selector of selectors) {
		try {
			const button = await page.$(selector)
			if (button && (await button.isVisible())) {
				await button.click()
				await sleep(2000)
				return true
			}
		} catch {}
	}

	try {
		const buttons = await page.$$('button')
		for (const button of buttons) {
			const text = await button.textContent()
			if (
				text &&
				(text.includes('Показать больше матчей') || text.includes('Show more'))
			) {
				if (await button.isVisible()) {
					await button.click()
					await sleep(2000)
					return true
				}
			}
		}
	} catch {}

	return false
}

async function loadAllMatches(page) {
	let clickCount = 0
	let noButtonCount = 0
	while (clickCount < 50 && noButtonCount < 3) {
		const clicked = await clickShowMoreButton(page)
		if (!clicked) {
			noButtonCount++
			await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
			await sleep(800)
		} else {
			noButtonCount = 0
			clickCount++
		}
	}

	for (let i = 0; i < 8; i++) {
		await page.evaluate(() => window.scrollBy(0, window.innerHeight))
		await sleep(400)
	}
}

async function extractMatchesFromPage(page) {
	return page.evaluate(() => {
		const matches = []
		let currentRound = ''

		const allElements = document.querySelectorAll(
			'.event__round, .event__match, .event__match--last, [class*="event__match"]',
		)

		for (const element of allElements) {
			const classList = element.className

			if (classList.includes('event__round')) {
				const text = element.innerText.trim()
				const numMatch = text.match(/(?:тур|round|т\.?)\s*(\d+)/i) || text.match(/^(\d+)\s*[.\s]/)
				if (numMatch) currentRound = numMatch[1]
				else {
					const roundMatch = text.match(/\d+/)
					if (roundMatch) currentRound = roundMatch[0]
				}
			} else if (classList.includes('event__match')) {
				try {
					const timeElement = element.querySelector('.event__time')
					let matchDate = timeElement ? timeElement.innerText.trim() : ''
					let matchTime = ''

					if (matchDate.includes('\n')) {
						const parts = matchDate.split('\n').map(s => s.trim())
						matchDate = parts[0]
						matchTime = parts[1] || ''
					}
					if (matchDate.includes('После')) {
						matchDate = matchDate.split(' ')[0]
					}

					let team1 = ''
					let team2 = ''
					const participantElements = element.querySelectorAll(
						'[data-testid*="participant"]',
					)

					if (participantElements.length >= 2) {
						const nameElements1 =
							participantElements[0].querySelectorAll('.wcl-name_jjfMf')
						const nameElements2 =
							participantElements[1].querySelectorAll('.wcl-name_jjfMf')
						if (nameElements1.length > 0)
							team1 = nameElements1[0].innerText.trim()
						if (nameElements2.length > 0)
							team2 = nameElements2[0].innerText.trim()
					}

					if (!team1 || !team2) {
						const teamSpans = element.querySelectorAll('.wcl-name_jjfMf')
						if (teamSpans.length >= 2) {
							team1 = teamSpans[0].innerText.trim()
							team2 = teamSpans[1].innerText.trim()
						}
					}

					let score1 = 0
					let score2 = 0
					const scoreElements = element.querySelectorAll(
						'[data-testid*="tableScore"]',
					)

					if (scoreElements.length >= 2) {
						for (const scoreEl of scoreElements) {
							const isPrimary =
								scoreEl.getAttribute('data-type') === 'primary'
							const side = scoreEl.getAttribute('data-side')
							if (isPrimary && side === 'home') {
								score1 = parseInt(scoreEl.innerText, 10) || 0
							} else if (isPrimary && side === 'away') {
								score2 = parseInt(scoreEl.innerText, 10) || 0
							}
						}
					}

					if (score1 === 0 && score2 === 0) {
						const homeScore = element.querySelector('.event__score--home')
						const awayScore = element.querySelector('.event__score--away')
						if (homeScore && awayScore) {
							score1 = parseInt(homeScore.innerText, 10) || 0
							score2 = parseInt(awayScore.innerText, 10) || 0
						}
					}

					let matchUrl = ''
					const linkElement = element.querySelector('a.eventRowLink')
					if (linkElement) {
						matchUrl = linkElement.getAttribute('href')
						if (matchUrl && !matchUrl.startsWith('http')) {
							matchUrl = `https://www.livescore.in${matchUrl}`
						}
					}

					let statusStage = ''
					const stageEl = element.querySelector(
						'.event__stage, .event__stage--block, [class*="event__stage"]',
					)
					if (stageEl) statusStage = stageEl.innerText.trim()

					const scoreFinished =
						score1 > 0 ||
						score2 > 0 ||
						/заверш|finished|ft|aet|пен/i.test(statusStage)

					if (team1 && team2) {
						matches.push({
							round: currentRound,
							matchDate,
							matchTime,
							team1,
							team2,
							score1,
							score2,
							url: matchUrl,
							statusStage,
							scoreFinished,
						})
					}
				} catch {}
			}
		}

		return matches
	})
}

async function parseHalfScores(page, matchUrl, match) {
	try {
		await page.goto(matchUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 20000,
		})
		await sleep(1500)

		return page.evaluate(matchData => {
			let firstHalfHome = 0
			let firstHalfAway = 0
			let secondHalfHome = matchData.score1
			let secondHalfAway = matchData.score2

			const sections = document.querySelectorAll('.wclHeaderSection--summary')
			for (const section of sections) {
				const titleSpan = section.querySelector(
					'.wcl-scores-overline-02_bpqU7, .wcl-overline_bRQEm',
				)
				const title = titleSpan ? titleSpan.innerText.trim().toLowerCase() : ''
				const scoreSpans = section.querySelectorAll('.wcl-scores_Na715')
				let scoreText = ''
				if (scoreSpans.length >= 2) {
					scoreText = scoreSpans[1].innerText.trim()
				} else if (scoreSpans.length === 1) {
					scoreText = scoreSpans[0].innerText.trim()
				}
				if (!scoreText) {
					const scoreMatch = section.innerText.match(/(\d+)\s*[-:]\s*(\d+)/)
					if (scoreMatch) scoreText = scoreMatch[0]
				}
				const scoreMatch = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/)
				if (!scoreMatch) continue
				const homeScore = parseInt(scoreMatch[1], 10)
				const awayScore = parseInt(scoreMatch[2], 10)
				if (
					title.includes('1-й') ||
					title.includes('1st') ||
					title.includes('ht') ||
					title.includes('перв')
				) {
					firstHalfHome = homeScore
					firstHalfAway = awayScore
				} else if (
					title.includes('2-й') ||
					title.includes('2nd') ||
					title.includes('втор')
				) {
					secondHalfHome = homeScore
					secondHalfAway = awayScore
				}
			}

			const htEl = document.querySelector(
				'[data-testid*="halftime"], .detailScore__halftime',
			)
			if (htEl && firstHalfHome === 0 && firstHalfAway === 0) {
				const htMatch = htEl.innerText.match(/(\d+)\s*[-:]\s*(\d+)/)
				if (htMatch) {
					firstHalfHome = parseInt(htMatch[1], 10)
					firstHalfAway = parseInt(htMatch[2], 10)
				}
			}

			secondHalfHome = matchData.score1 - firstHalfHome
			secondHalfAway = matchData.score2 - firstHalfAway

			return {
				firstHalfHome,
				firstHalfAway,
				secondHalfHome,
				secondHalfAway,
			}
		}, match)
	} catch {
		return {
			firstHalfHome: 0,
			firstHalfAway: 0,
			secondHalfHome: match.score1,
			secondHalfAway: match.score2,
		}
	}
}

async function parseLineupsFromPage(page, matchUrl) {
	return fetchLineups(page, matchUrl, sleep)
}

async function parseLineups(page, matchUrl) {
	try {
		return await parseLineupsFromPage(page, matchUrl)
	} catch {
		return { homePlayers: [], awayPlayers: [] }
	}
}

function parseMatchDate(dateStr) {
	if (!dateStr) return new Date(0)
	const parts = dateStr.split('.')
	if (parts.length === 3) {
		return new Date(
			parseInt(parts[2], 10),
			parseInt(parts[1], 10) - 1,
			parseInt(parts[0], 10),
		)
	}
	return new Date(0)
}

function emptyPpg() {
	const z = { home: '0', away: '0', gap: '0', gapNum: 0 }
	return { tt: { ...z }, ha: { ...z }, ht: { ...z }, st: { ...z } }
}

function formatPlayer(p) {
	const goals = p.goals != null ? p.goals : 0
	return `${p.name} (${goals})`
}

function buildMatchRow({
	match,
	details,
	listStatus,
	skippedBracket,
	leagueId,
	country,
	league,
	leagueLabel,
}) {
	const status = details?.status || listStatus
	const parseSkipped = details?.parseSkipped === true
	const d = details || {
		firstHalfHome: 0,
		firstHalfAway: 0,
		secondHalfHome: match.score1,
		secondHalfAway: match.score2,
		homeGoals: [],
		awayGoals: [],
		ownGoals: [],
		homeLineup: [],
		awayLineup: [],
	}

	const ht = `${d.firstHalfHome}-${d.firstHalfAway}`
	const ft = `${match.score1}-${match.score2}`
	const st = `${d.secondHalfHome}-${d.secondHalfAway}`
	const scoreDisplay =
		status === 'finished' ? `(${ft}) ${ht} | ${st}` : ft

	return {
		id: `${leagueId || league}_${match.matchDate}_${match.team1}_${match.team2}`.replace(
			/\s+/g,
			'_',
		),
		leagueId: leagueId || null,
		country,
		league,
		round: match.round,
		date: match.matchDate,
		time: match.matchTime || '',
		leagueLabel,
		homeTeam: match.team1,
		awayTeam: match.team2,
		score1: match.score1,
		score2: match.score2,
		firstHalfHome: d.firstHalfHome,
		firstHalfAway: d.firstHalfAway,
		secondHalfHome: d.secondHalfHome,
		secondHalfAway: d.secondHalfAway,
		scoreDisplay,
		url: match.url,
		status,
		parseSkipped,
		skippedBracket: !!skippedBracket,
		homeGoals: d.homeGoals,
		awayGoals: d.awayGoals,
		ownGoals: d.ownGoals,
		homeLineup: d.homeLineup,
		awayLineup: d.awayLineup,
		ppg: emptyPpg(),
	}
}

/**
 * Сводка матча (голы) + отдельно страница составов.
 */
/** Только таймлайн (голы) — быстрее для массового backfill */
async function parseGoalsOnly(page, matchUrl, match) {
	const empty = {
		homeGoals: [],
		awayGoals: [],
		ownGoals: [],
		firstHalfHome: 0,
		firstHalfAway: 0,
		secondHalfHome: 0,
		secondHalfAway: 0,
	}
	if (!matchUrl) return empty

	try {
		const summaryUrl = buildSummaryUrl(matchUrl)
		await page.goto(summaryUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 25000,
		})
		await sleep(3000)

		const goalsData = await page.evaluate(parseGoalsInPage, {
			score1: match.score1,
			score2: match.score2,
			team1: match.team1,
			team2: match.team2,
		})

		return {
			homeGoals: goalsData.homeGoals,
			awayGoals: goalsData.awayGoals,
			ownGoals: goalsData.ownGoals,
			firstHalfHome: goalsData.firstHalfHome,
			firstHalfAway: goalsData.firstHalfAway,
			secondHalfHome: goalsData.secondHalfHome,
			secondHalfAway: goalsData.secondHalfAway,
		}
	} catch {
		return empty
	}
}

async function parseMatchFull(page, matchUrl, match) {
	const empty = {
		skippedBracket: false,
		firstHalfHome: 0,
		firstHalfAway: 0,
		secondHalfHome: match.score1,
		secondHalfAway: match.score2,
		homeGoals: [],
		awayGoals: [],
		ownGoals: [],
		homeLineup: [],
		awayLineup: [],
	}

	if (!matchUrl) return empty

	const status = detectStatusFromList(match)
	if (status !== 'finished') {
		return { ...empty, status, parseSkipped: true }
	}

	try {
		const summaryUrl = buildSummaryUrl(matchUrl)
		await page.goto(summaryUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 25000,
		})
		await sleep(1200)

		const isBracket = await page.evaluate(hasBracketTabInPage)
		if (isBracket) {
			return { ...empty, skippedBracket: true, status: 'finished' }
		}

		const goalsData = await page.evaluate(parseGoalsInPage, {
			score1: match.score1,
			score2: match.score2,
			team1: match.team1,
			team2: match.team2,
		})

		let firstHalfHome = goalsData.firstHalfHome
		let firstHalfAway = goalsData.firstHalfAway
		let secondHalfHome = goalsData.secondHalfHome
		let secondHalfAway = goalsData.secondHalfAway

		const totalParsed =
			goalsData.homeGoals.length + goalsData.awayGoals.length

		if (totalParsed === 0 && (match.score1 > 0 || match.score2 > 0)) {
			const halves = await page.evaluate(m => {
				let fh = 0,
					fa = 0
				const sections = document.querySelectorAll(
					'.wclHeaderSection--summary',
				)
				for (const section of sections) {
					const titleSpan = section.querySelector(
						'.wcl-scores-overline-02_bpqU7, .wcl-overline_bRQEm',
					)
					const title = titleSpan
						? titleSpan.innerText.trim().toLowerCase()
						: ''
					const scoreSpans = section.querySelectorAll('.wcl-scores_Na715')
					const scoreText =
						scoreSpans.length >= 2 ? scoreSpans[1].innerText : ''
					const scoreMatch = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/)
					if (!scoreMatch) continue
					const h = parseInt(scoreMatch[1], 10)
					const a = parseInt(scoreMatch[2], 10)
					if (
						title.includes('1-й') ||
						title.includes('1st') ||
						title.includes('ht')
					) {
						fh = h
						fa = a
					}
				}
				return {
					firstHalfHome: fh,
					firstHalfAway: fa,
					secondHalfHome: m.score1 - fh,
					secondHalfAway: m.score2 - fa,
				}
			}, match)
			firstHalfHome = halves.firstHalfHome
			firstHalfAway = halves.firstHalfAway
			secondHalfHome = halves.secondHalfHome
			secondHalfAway = halves.secondHalfAway
		} else if (totalParsed > 0) {
			secondHalfHome = goalsData.secondHalfHome
			secondHalfAway = goalsData.secondHalfAway
		}

		let lineups = await fetchLineupsOnCurrentPage(page, sleep)
		if (!hasUsableLineup(lineups)) {
			lineups = await fetchLineups(page, matchUrl, sleep)
		}

		if (!hasUsableLineup(lineups)) {
			console.warn(
				`  ⚠ неполный состав: ${match.team1 || ''} ${lineups.homePlayers.length} — ${match.team2 || ''} ${lineups.awayPlayers.length}`,
			)
		}

		const result = {
			skippedBracket: false,
			status: 'finished',
			firstHalfHome,
			firstHalfAway,
			secondHalfHome,
			secondHalfAway,
			homeGoals: goalsData.homeGoals,
			awayGoals: goalsData.awayGoals,
			ownGoals: goalsData.ownGoals,
			homeLineup: lineups.homePlayers,
			awayLineup: lineups.awayPlayers,
		}
		applyOwnGoalsToMatch(result)
		return result
	} catch {
		return { ...empty, status }
	}
}

async function loadLeagueData({
	leagueId,
	seasonUrl,
	leagueLabel,
	country,
	league,
	season,
	concurrent = parseInt(process.env.CONCURRENT || '6', 10),
	headless = true,
	limit = 0,
}) {
	const browser = await chromium.launch({
		headless,
		args: [
			'--disable-blink-features=AutomationControlled',
			'--no-sandbox',
			'--disable-dev-shm-usage',
		],
	})

	const context = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		viewport: { width: 1280, height: 900 },
	})
	await context.route('**/*', route => {
		const type = route.request().resourceType()
		if (['image', 'media', 'font'].includes(type)) {
			return route.abort()
		}
		return route.continue()
	})

	const page = await context.newPage()

	try {
		console.log(`Загрузка списка матчей: ${seasonUrl}`)
		await page.goto(seasonUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		})
		await sleep(1500)
		await loadAllMatches(page)

		const rawMatches = await extractMatchesFromPage(page)
		const unique = []
		const seen = new Set()

		for (const match of rawMatches) {
			const key = `${match.matchDate}-${match.team1}-${match.team2}`
			if (!seen.has(key)) {
				seen.add(key)
				unique.push(match)
			}
		}

		unique.sort(
			(a, b) => parseMatchDate(a.matchDate) - parseMatchDate(b.matchDate),
		)

		console.log(`Найдено матчей: ${unique.length}`)

		const toProcess = limit > 0 ? unique.slice(0, limit) : unique
		if (limit > 0) {
			console.log(`Ограничение: обрабатываем ${toProcess.length} матчей`)
		}

		const enriched = []

		for (let i = 0; i < toProcess.length; i += concurrent) {
			const batch = toProcess.slice(i, i + concurrent)
			const batchResults = await Promise.all(
				batch.map(async (match, idx) => {
					const detailPage = await context.newPage()
					try {
						const globalIdx = i + idx + 1
						console.log(
							`[${globalIdx}/${toProcess.length}] ${match.matchDate} ${match.team1} — ${match.team2}`,
						)

						const listStatus = detectStatusFromList(match)

						if (!match.url) {
							return buildMatchRow({
								match,
								details: null,
								listStatus,
								skippedBracket: false,
								leagueId,
								country,
								league,
								leagueLabel,
							})
						}

						const details = await parseMatchFull(
							detailPage,
							match.url,
							match,
						)

						if (details.skippedBracket) {
							console.log(
								`  ⏭ сетка (не парсим): ${match.team1} — ${match.team2}`,
							)
							return null
						}

						return buildMatchRow({
							match,
							details,
							listStatus: details.status || listStatus,
							skippedBracket: false,
							leagueId,
							country,
							league,
							leagueLabel,
						})
					} finally {
						await detailPage.close()
					}
				}),
			)

			enriched.push(...batchResults.filter(Boolean))
		}

		enriched.sort(
			(a, b) => parseMatchDate(a.date) - parseMatchDate(b.date),
		)
		attachCumulativeGoalsToMatches(enriched)
		attachPpgToMatches(enriched)

		return {
			meta: {
				leagueId: leagueId || null,
				country,
				league,
				season,
				seasonUrl,
				leagueLabel,
				loadedAt: new Date().toISOString(),
				matchCount: enriched.length,
			},
			matches: enriched,
		}
	} finally {
		await browser.close()
	}
}

module.exports = {
	sleep,
	loadLeagueData,
	parseMatchDate,
	formatPlayer,
	emptyPpg,
	parseHalfScores,
	parseLineups,
	parseMatchFull,
	parseGoalsOnly,
	buildMatchRow,
}
