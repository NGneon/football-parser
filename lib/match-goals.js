/**
 * Парсинг голов с таймлайна Livescore: только обычные голы.
 * Автоголы и отменённые голы не входят в счёт игроков и таймов.
 */

function normalizeName(name) {
	return String(name || '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, ' ')
}

/** Сопоставление «Фамилия И.» с бомбардиром на таймлайне */
function namesMatch(lineupName, scorerName) {
	const a = normalizeName(lineupName)
	const b = normalizeName(scorerName)
	if (!a || !b) return false
	if (a === b || a.includes(b) || b.includes(a)) return true

	const partsA = a.split(/[\s.]+/).filter(Boolean)
	const partsB = b.split(/[\s.]+/).filter(Boolean)
	if (partsA[0] && partsB[0] && partsA[0] === partsB[0]) return true
	if (partsA.length > 1 && partsB.length > 1) {
		const lastA = partsA[partsA.length - 1]
		const lastB = partsB[partsB.length - 1]
		if (lastA.length === 1 && partsA[0] === partsB[0]) return true
		if (lastB.length === 1 && partsA[0] === partsB[0]) return true
	}
	return false
}

function sortLineupByGoals(players) {
	return [...players].sort((a, b) => {
		const dg = (b.goals || 0) - (a.goals || 0)
		if (dg !== 0) return dg
		return String(a.name).localeCompare(String(b.name), 'ru')
	})
}

/**
 * Стартовый состав + любой забивший с таймлайна (в т.ч. с замены).
 * Каждый гол в homeGoals/awayGoals = +1 соответствующему игроку.
 */
function buildLineupWithGoals(lineup, goals) {
	const events = goals || []
	const used = new Array(events.length).fill(false)
	const players = []

	for (const raw of lineup || []) {
		const base =
			typeof raw === 'string'
				? { name: String(raw).trim(), number: '?' }
				: { ...raw }
		const name = base.name
		if (!name) continue

		let goalsCount = 0
		events.forEach((g, i) => {
			if (!used[i] && namesMatch(name, g.name)) {
				goalsCount++
				used[i] = true
			}
		})
		players.push({ ...base, name, goals: goalsCount })
	}

	const extra = new Map()
	events.forEach((g, i) => {
		if (used[i]) return
		const key = g.name.trim()
		extra.set(key, (extra.get(key) || 0) + 1)
	})

	for (const [name, goalsCount] of extra) {
		if (players.some(p => namesMatch(p.name, name))) continue
		players.push({ name, number: '?', goals: goalsCount })
	}

	return sortLineupByGoals(players)
}

function attachGoalsToMatch(match) {
	const homeGoals = match.homeGoals || []
	const awayGoals = match.awayGoals || []
	match.homeLineup = buildLineupWithGoals(match.homeLineup, homeGoals)
	match.awayLineup = buildLineupWithGoals(match.awayLineup, awayGoals)
	return match
}

/** Код для page.evaluate — парсинг таймлайна на странице матча */
function parseGoalsInPage(matchData) {
	const homeGoals = []
	const awayGoals = []
	const ownGoals = []
	let firstHalfHome = 0
	let firstHalfAway = 0
	let secondHalfHome = 0
	let secondHalfAway = 0

	function parseMinute(text) {
		if (!text) return null
		const m = String(text).match(/(\d+)(?:\s*\+\s*(\d+))?/)
		if (!m) return null
		return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0)
	}

	function isOwnGoal(el) {
		const html = (el.innerHTML || '').toLowerCase()
		const text = (el.innerText || '').toLowerCase()
		if (
			el.querySelector(
				'.footballOwnGoal-ico, [class*="ownGoal"], [class*="own-goal"], [data-testid*="ownGoal"]',
			)
		) {
			return true
		}
		if (
			text.includes('автогол') ||
			text.includes('own goal') ||
			text.includes('own-goal')
		) {
			return true
		}
		if (html.includes('owngoal') || html.includes('own-goal')) return true
		const cls = String(el.className || '').toLowerCase()
		return cls.includes('owngoal') || cls.includes('own-goal')
	}

	function isDisallowedGoal(el) {
		const text = (el.innerText || '').toLowerCase()
		const html = (el.innerHTML || '').toLowerCase()
		if (
			el.querySelector(
				'[class*="disallowed"], [class*="cancelled"], [class*="varCancel"], [class*="noGoal"], [class*="goalCancelled"]',
			)
		) {
			return true
		}
		if (
			text.includes('отмен') ||
			text.includes('не засчитан') ||
			text.includes('disallowed') ||
			text.includes('no goal') ||
			text.includes('goal cancelled')
		) {
			return true
		}
		if (
			(text.includes('var') || html.includes('var')) &&
			(text.includes('отмен') ||
				text.includes('cancel') ||
				html.includes('disallowed'))
		) {
			return true
		}
		return false
	}

	function hasGoalIcon(el) {
		if (
			el.querySelector(
				'.footballGoal-ico, .icon--soccer, [class*="Goal-ico"]:not([class*="own"]), svg[class*="goal"]',
			)
		) {
			return true
		}
		const html = (el.innerHTML || '').toLowerCase()
		const text = (el.innerText || '').toLowerCase()
		if (html.includes('footballgoal-ico')) return true
		if (html.includes('soccer') && html.includes('ico')) return true

		const scoreInEvent = text.match(/\b(\d+)\s*[-–]\s*(\d+)\b/)
		if (
			scoreInEvent &&
			(html.includes('goal') ||
				el.querySelector(
					'[class*="incidentHomeScore"], [class*="incidentAwayScore"], [class*="incidentScore"]',
				))
		) {
			return true
		}

		const cls = String(el.className || '').toLowerCase()
		if (cls.includes('goal') && !cls.includes('own')) return true

		return false
	}

	function isRegularGoalEvent(el) {
		if (isOwnGoal(el)) return false
		if (isDisallowedGoal(el)) return false
		if (hasGoalIcon(el)) return true

		const text = (el.innerText || '').trim()
		if (!text || text.length < 3) return false
		if (/гол не засчитан|не засчитан|disallowed|отменён|отменен/i.test(text)) {
			return false
		}
		// "59'\n1 - 2\nЭльведи Н." — типичный гол на Livescore
		if (
			/\d+['']?/.test(text) &&
			/\d+\s*[-–]\s*\d+/.test(text) &&
			(el.querySelector('a[href*="/player/"]') ||
				/[A-Za-zА-Яа-яЁё]{2,}/.test(text))
		) {
			return true
		}
		return false
	}

	function extractScorerName(el) {
		const links = el.querySelectorAll('a[href*="/player/"]')
		for (const link of links) {
			const name = link.innerText.trim().replace(/\s*\([^)]*\)\s*$/, '')
			if (name && name.length > 1 && !/^\d+$/.test(name)) return name
		}

		const playerEl = el.querySelector('.smv__playerName, [class*="playerName"]')
		if (playerEl) {
			const name = playerEl.innerText.trim()
			if (name.length > 1) return name
		}

		const lines = (el.innerText || '')
			.split('\n')
			.map(s => s.trim())
			.filter(Boolean)
		for (const line of lines) {
			if (/^\d+['']?$/.test(line)) continue
			if (/^\d+\s*[-–]\s*\d+$/.test(line)) continue
			if (/^\(.+\)$/.test(line)) continue
			if (/гол|goal|ассист|assist|var|карт|card/i.test(line)) continue
			if (/^[A-Za-zА-Яа-яЁё]/.test(line)) {
				return line.replace(/\s*\([^)]*\)\s*$/, '').trim()
			}
		}
		return ''
	}

	function detectSide(el) {
		const html = el.outerHTML.toLowerCase()
		if (
			el.closest('[class*="home"], [class*="left"]') ||
			html.includes('home') ||
			el.classList.contains('smv__homeParticipant')
		) {
			return 'home'
		}
		if (
			el.closest('[class*="away"], [class*="right"]') ||
			html.includes('away') ||
			el.classList.contains('smv__awayParticipant')
		) {
			return 'away'
		}
		const row = el.closest('.smv__row')
		if (row) {
			if (row.classList.contains('smv__homeParticipant')) return 'home'
			if (row.classList.contains('smv__awayParticipant')) return 'away'
		}
		return null
	}

	const events = new Set()
	document.querySelectorAll('.smv__incident').forEach(el => {
		if (!el.classList.contains('smv__empty')) events.add(el)
	})
	document.querySelectorAll('.smv__row').forEach(el => {
		if (el.querySelector('.smv__incident') && !el.classList.contains('smv__empty')) {
			events.add(el)
		}
	})

	const processed = new Set()

	for (const el of events) {
		if (!isRegularGoalEvent(el) && !isOwnGoal(el)) continue

		let minute = null
		const timeEl = el.querySelector(
			'.smv__timeBox, .time, [class*="time"], [class*="minute"]',
		)
		if (timeEl) minute = parseMinute(timeEl.innerText)
		if (minute == null) {
			const tm = el.innerText.match(/(\d+)(?:\s*\+\s*(\d+))?'/)
			if (tm) minute = parseInt(tm[1], 10) + (tm[2] ? parseInt(tm[2], 10) : 0)
		}
		if (minute == null) continue

		const key = `${minute}-${el.innerText.slice(0, 40)}`
		if (processed.has(key)) continue
		processed.add(key)

		const isFirstHalf = minute <= 45

		if (isOwnGoal(el)) {
			const side = detectSide(el) || 'home'
			ownGoals.push({
				team: side,
				minute,
				half: isFirstHalf ? 1 : 2,
			})
			continue
		}

		if (!isRegularGoalEvent(el)) continue

		const scorer = extractScorerName(el)
		if (!scorer || scorer.length < 2) continue

		const side = detectSide(el)
		const goal = { name: scorer, minute }

		if (side === 'home') {
			homeGoals.push(goal)
			if (isFirstHalf) firstHalfHome++
			else secondHalfHome++
		} else if (side === 'away') {
			awayGoals.push(goal)
			if (isFirstHalf) firstHalfAway++
			else secondHalfAway++
		}
	}

	// Счёт по таймам из заголовков — запасной вариант, если событий нет
	if (
		homeGoals.length === 0 &&
		awayGoals.length === 0 &&
		(matchData.score1 > 0 || matchData.score2 > 0)
	) {
		const sections = document.querySelectorAll('.wclHeaderSection--summary')
		for (const section of sections) {
			const titleSpan = section.querySelector(
				'.wcl-scores-overline-02_bpqU7, .wcl-overline_bRQEm',
			)
			const title = titleSpan ? titleSpan.innerText.trim().toLowerCase() : ''
			const scoreSpans = section.querySelectorAll('.wcl-scores_Na715')
			let scoreText = scoreSpans.length >= 2 ? scoreSpans[1].innerText : ''
			const scoreMatch = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/)
			if (!scoreMatch) continue
			const h = parseInt(scoreMatch[1], 10)
			const a = parseInt(scoreMatch[2], 10)
			if (title.includes('1-й') || title.includes('1st') || title.includes('ht')) {
				firstHalfHome = h
				firstHalfAway = a
			} else if (title.includes('2-й') || title.includes('2nd')) {
				secondHalfHome = h
				secondHalfAway = a
			}
		}
	}

	if (firstHalfHome === 0 && firstHalfAway === 0 && homeGoals.length + awayGoals.length > 0) {
		// уже посчитано из событий
	} else if (
		firstHalfHome === 0 &&
		firstHalfAway === 0 &&
		secondHalfHome === 0 &&
		secondHalfAway === 0 &&
		homeGoals.length + awayGoals.length > 0
	) {
		// пересчёт из массивов голов
		firstHalfHome = homeGoals.filter(g => g.minute <= 45).length
		firstHalfAway = awayGoals.filter(g => g.minute <= 45).length
		secondHalfHome = homeGoals.filter(g => g.minute > 45).length
		secondHalfAway = awayGoals.filter(g => g.minute > 45).length
	}

	if (
		secondHalfHome === 0 &&
		secondHalfAway === 0 &&
		homeGoals.length + awayGoals.length > 0
	) {
		secondHalfHome = homeGoals.filter(g => g.minute > 45).length
		secondHalfAway = awayGoals.filter(g => g.minute > 45).length
	}

	return {
		homeGoals,
		awayGoals,
		ownGoals,
		firstHalfHome,
		firstHalfAway,
		secondHalfHome,
		secondHalfAway,
	}
}

module.exports = {
	normalizeName,
	namesMatch,
	sortLineupByGoals,
	buildLineupWithGoals,
	attachGoalsToMatch,
	parseGoalsInPage,
}
