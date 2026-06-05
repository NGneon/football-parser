/**
 * Полный состав (старт + запасные) с Livescore / Flashscore
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
			if (await tab.isVisible({ timeout: 1500 })) {
				await tab.click()
				await sleep(1200)
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
				await sleep(1200)
				return true
			}
		}
	} catch {}

	return false
}

async function waitForLineupsDom(page) {
	await page
		.waitForSelector(
			'.lf__sides, [data-testid*="lineupsParticipant"]',
			{ timeout: 12000 },
		)
		.catch(() => {})
}

function lineupScore(result) {
	return (result?.homePlayers?.length || 0) + (result?.awayPlayers?.length || 0)
}

function hasUsableLineup(result) {
	return (
		(result?.homePlayers?.length || 0) >= 7 &&
		(result?.awayPlayers?.length || 0) >= 7
	)
}

/** Один заход: summary → составы (без повторного goto) */
async function fetchLineupsOnCurrentPage(page, sleep) {
	await openLineupsTab(page, sleep)
	await waitForLineupsDom(page)
	await sleep(500)
	return page.evaluate(extractLineupsInPage)
}

async function fetchLineups(page, matchUrl, sleep) {
	let best = { homePlayers: [], awayPlayers: [] }

	const tryLineupsUrl = async () => {
		await page.goto(buildLineupsUrl(matchUrl), {
			waitUntil: 'domcontentloaded',
			timeout: 25000,
		})
		await sleep(1500)
		await waitForLineupsDom(page)
		return page.evaluate(extractLineupsInPage)
	}

	const trySummaryTab = async () => {
		await page.goto(buildSummaryUrl(matchUrl), {
			waitUntil: 'domcontentloaded',
			timeout: 25000,
		})
		await sleep(1200)
		return fetchLineupsOnCurrentPage(page, sleep)
	}

	for (const attempt of [trySummaryTab, tryLineupsUrl]) {
		try {
			const result = await attempt()
			if (hasUsableLineup(result)) return result
			if (lineupScore(result) > lineupScore(best)) best = result
		} catch {}
	}

	return best
}

/** Полный состав: все игроки на вкладке (старт + скамейка) */
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
			el.closest(
				'[data-testid*="lineupsParticipantGeneral"], [data-testid*="lineupsParticipant"]',
			) || el
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

		const isSub =
			!!participant.closest('[class*="bench"], [class*="substitute"]') ||
			/participantSubstitute|Substitute/i.test(
				participant.getAttribute('data-testid') || '',
			)

		return { name, number: number || '?', role: isSub ? 'sub' : 'starter' }
	}

	function collectSide(side) {
		const hint = side === 'home' ? 'left' : 'right'
		const players = []
		const seen = new Set()

		const selectors = [
			`[data-testid*="lineupsParticipantGeneral-${hint}"]`,
			`[data-testid*="lineupsParticipant-${hint}"]`,
			`[data-testid*="lineupsParticipantSubstitute-${hint}"]`,
		]

		let nodes = []
		for (const sel of selectors) {
			document.querySelectorAll(sel).forEach(n => nodes.push(n))
		}

		if (!nodes.length) {
			let bestSides = null
			let bestCount = 0
			for (const sides of document.querySelectorAll('.lf__sides')) {
				const n = sides.querySelectorAll(
					`[data-testid*="${hint}"]`,
				).length
				if (n > bestCount) {
					bestCount = n
					bestSides = sides
				}
			}
			if (bestSides) {
				nodes = [...bestSides.querySelectorAll(`[data-testid*="${hint}"]`)]
			}
		}

		let starterCount = 0
		for (const el of nodes) {
			const p = extractFromParticipant(el)
			if (!p) continue
			const key = p.name.toLowerCase()
			if (seen.has(key)) continue
			seen.add(key)

			if (p.role !== 'sub') {
				starterCount++
				if (starterCount > 11) p.role = 'sub'
			}

			players.push(p)
		}

		return players
	}

	return {
		homePlayers: collectSide('home'),
		awayPlayers: collectSide('away'),
	}
}

module.exports = {
	buildSummaryUrl,
	buildLineupsUrl,
	openLineupsTab,
	waitForLineupsDom,
	extractLineupsInPage,
	fetchLineups,
	fetchLineupsOnCurrentPage,
	hasUsableLineup,
}
