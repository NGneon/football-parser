/**
 * Парсинг стартовых составов (11 игроков) с Livescore / Flashscore
 */

function splitMatchUrl(matchUrl) {
	const qIndex = matchUrl.indexOf('?')
	return {
		path: (qIndex >= 0 ? matchUrl.slice(0, qIndex) : matchUrl).replace(/\/$/, ''),
		query: qIndex >= 0 ? matchUrl.slice(qIndex) : '',
	}
}

function buildSummaryUrl(matchUrl) {
	if (!matchUrl) return ''
	if (/\/summary(\/|$)/i.test(matchUrl) && !/lineups/i.test(matchUrl)) {
		return matchUrl
	}
	const { path, query } = splitMatchUrl(matchUrl)
	const base = path
		.replace(/\/summary\/lineups\/?$/i, '')
		.replace(/\/lineups\/?$/i, '')
		.replace(/\/summary\/?$/i, '')
	return `${base}/summary/${query}`
}

function buildLineupsUrl(matchUrl) {
	if (!matchUrl) return ''
	if (/summary\/lineups/i.test(matchUrl)) return matchUrl

	const { path, query } = splitMatchUrl(matchUrl)
	const base = path
		.replace(/\/summary\/lineups\/?$/i, '')
		.replace(/\/lineups\/?$/i, '')
		.replace(/\/summary\/?$/i, '')
	return `${base}/summary/lineups/${query}`
}

/** Клик по вкладке «Составы» на странице матча (после обзора) */
async function openLineupsTab(page, sleep) {
	const selectors = [
		'button[data-testid="wcl-tab"]:has-text("Составы")',
		'button[data-testid="wcl-tab"]:has-text("Lineups")',
		'a[data-analytics-alias="lineups"]',
		'[role="tab"]:has-text("Составы")',
		'[role="tab"]:has-text("Lineups")',
	]

	for (const selector of selectors) {
		try {
			const tab = page.locator(selector).first()
			if (await tab.isVisible({ timeout: 2000 })) {
				await tab.click()
				await sleep(2500)
				return true
			}
		} catch {}
	}

	try {
		const tabs = await page.$$('button[data-testid="wcl-tab"]')
		for (const tab of tabs) {
			const text = (await tab.textContent())?.trim() || ''
			if (/состав|lineup/i.test(text)) {
				await tab.click()
				await sleep(2500)
				return true
			}
		}
	} catch {}

	return false
}

async function waitForLineupsDom(page) {
	await page
		.waitForSelector(
			'.lf__sides, [data-testid*="lineupsParticipantGeneral"]',
			{ timeout: 20000 },
		)
		.catch(() => {})
	await page
		.waitForSelector('[data-testid*="lineupsParticipantGeneral-left"]', {
			timeout: 8000,
		})
		.catch(() => {})
}

function lineupScore(result) {
	return (result?.homePlayers?.length || 0) + (result?.awayPlayers?.length || 0)
}

function isCompleteLineup(result) {
	return (
		(result?.homePlayers?.length || 0) >= 11 &&
		(result?.awayPlayers?.length || 0) >= 11
	)
}

/** Несколько попыток: прямой URL составов, затем вкладка на обзоре */
async function fetchLineups(page, matchUrl, sleep) {
	let best = { homePlayers: [], awayPlayers: [] }

	const tryDirect = async () => {
		await page.goto(buildLineupsUrl(matchUrl), {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		})
		await sleep(3500)
		await waitForLineupsDom(page)
		await sleep(800)
		return page.evaluate(extractLineupsInPage)
	}

	const tryTab = async () => {
		await page.goto(buildSummaryUrl(matchUrl), {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		})
		await sleep(2500)
		const tabOpened = await openLineupsTab(page, sleep)
		if (!tabOpened) {
			return tryDirect()
		}
		await waitForLineupsDom(page)
		await sleep(1000)
		return page.evaluate(extractLineupsInPage)
	}

	for (const attempt of [tryDirect, tryTab, tryDirect]) {
		try {
			const result = await attempt()
			if (isCompleteLineup(result)) return result
			if (lineupScore(result) > lineupScore(best)) best = result
		} catch {}
	}

	return best
}

/** Код для page.evaluate — первые 11 = стартовый состав */
function extractLineupsInPage() {
	function cleanName(raw) {
		return String(raw || '')
			.replace(/\n/g, ' ')
			.replace(/\s*\([^)]*\)\s*$/g, '')
			.replace(/\s*\(В\)\s*/gi, '')
			.replace(/\s*\(C\)\s*/gi, '')
			.trim()
	}

	function extractFromParticipant(el) {
		const participant =
			el.closest('[data-testid*="lineupsParticipantGeneral"]') || el
		const container = participant.closest('.lf__participantNew') || participant

		let number = ''
		const numberEl = participant.querySelector(
			'span[class*="wcl-number"], span[class*="number"]',
		)
		if (numberEl) {
			const n = numberEl.innerText.trim()
			if (/^\d{1,2}$/.test(n)) number = n
		}

		let name = ''
		const nameEl = participant.querySelector(
			'[class*="wcl-name"], [class*="name_Zggy"]',
		)
		if (nameEl) name = cleanName(nameEl.innerText)

		if (!name) {
			const nameBtn = participant.querySelector('button[class*="nameWrapper"]')
			const inner = nameBtn?.querySelector('[class*="wcl-name"]')
			if (inner) name = cleanName(inner.innerText)
		}

		if (!name) {
			const link = container.querySelector('a[href*="/player/"]')
			if (link) name = cleanName(link.innerText)
		}

		if (!number || !name) {
			const text = container.innerText.replace(/\n/g, ' ').trim()
			const parsed = text.match(
				/^(\d{1,2})\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё.\s\-']+?)(?:\s*\(|$)/,
			)
			if (parsed) {
				if (!number) number = parsed[1]
				if (!name) name = cleanName(parsed[2])
			}
		}

		if (!name || name.length < 2 || /^\d+$/.test(name)) return null
		if (/тренер|coach|manager/i.test(name)) return null
		return { name, number: number || '?' }
	}

	function collectStarting(side) {
		const hint = side === 'home' ? 'left' : 'right'
		const players = []
		const seen = new Set()

		let nodes = []
		let bestSides = null
		let bestCount = 0
		for (const sides of document.querySelectorAll('.lf__sides')) {
			const n = sides.querySelectorAll(
				`[data-testid*="lineupsParticipantGeneral-${hint}"]`,
			).length
			if (n > bestCount) {
				bestCount = n
				bestSides = sides
			}
		}
		if (bestSides) {
			nodes = bestSides.querySelectorAll(
				`[data-testid*="lineupsParticipantGeneral-${hint}"]`,
			)
		} else {
			nodes = document.querySelectorAll(
				`[data-testid*="lineupsParticipantGeneral-${hint}"]`,
			)
		}

		for (const el of nodes) {
			const p = extractFromParticipant(el)
			if (!p) continue
			const key = p.name.toLowerCase()
			if (seen.has(key)) continue
			seen.add(key)
			players.push(p)
			if (players.length >= 11) break
		}

		return players
	}

	return {
		homePlayers: collectStarting('home'),
		awayPlayers: collectStarting('away'),
	}
}

module.exports = {
	buildSummaryUrl,
	buildLineupsUrl,
	openLineupsTab,
	waitForLineupsDom,
	extractLineupsInPage,
	fetchLineups,
	isCompleteLineup,
}
