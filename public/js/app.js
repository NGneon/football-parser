const MONTHS_RU = [
	'Январь',
	'Февраль',
	'Март',
	'Апрель',
	'Май',
	'Июнь',
	'Июль',
	'Август',
	'Сентябрь',
	'Октябрь',
	'Ноябрь',
	'Декабрь',
]

/** Управление загруженным экраном */
function showLoadingOverlay(text = 'Загрузка данных...') {
	const overlay = document.getElementById('loading-overlay')
	const loadingText = document.getElementById('loading-text')
	if (overlay) {
		overlay.classList.remove('hidden')
		if (loadingText) loadingText.textContent = text
	}
}

function hideLoadingOverlay() {
	const overlay = document.getElementById('loading-overlay')
	if (overlay) {
		setTimeout(() => {
			overlay.classList.add('hidden')
		}, 300)
	}
}

let allData = { meta: {}, matches: [], tree: [] }
let availableDates = []
/** @type {Map<string, {date:string,total:number,upcoming:number,finished:number}>} */
let calendarDays = new Map()
let selectedDate = null
/** id лиг из leagues.config.json, отмеченных в фильтре */
const selectedLeagueIds = new Set()
/** Порядок выбора лиг (Англия → Германия и т.д.) */
const selectedLeagueOrder = []

// Кеш для загруженных лиг (оптимизация)
const leagueCache = new Map()

function addSelectedLeague(id) {
	if (!id || selectedLeagueIds.has(id)) return
	selectedLeagueIds.add(id)
	selectedLeagueOrder.push(id)
}

function removeSelectedLeague(id) {
	if (!id) return
	selectedLeagueIds.delete(id)
	const i = selectedLeagueOrder.indexOf(id)
	if (i >= 0) selectedLeagueOrder.splice(i, 1)
}

function setSelectedLeagues(ids, checked) {
	for (const id of ids) {
		if (checked) addSelectedLeague(id)
		else removeSelectedLeague(id)
	}
}
const expandedLineups = new Set() // legacy, lineups always expanded now

const container = document.getElementById('matches-container')
const dateLabel = document.getElementById('date-label')
const calendarPopup = document.getElementById('calendar-popup')
const calDay = document.getElementById('cal-day')
const calMonth = document.getElementById('cal-month')
const calYear = document.getElementById('cal-year')
const calendarGrid = document.getElementById('calendar-grid')
const countryDropdown = document.getElementById('country-dropdown')
const countryTree = document.getElementById('country-tree')
const btnCountry = document.getElementById('btn-country')

const PPG_ROWS = [
	{ key: 'tt', label: 'PPG (TT)' },
	{ key: 'ha', label: 'PPG (H/A)' },
	{ key: 'ht', label: 'PPG (H/T)' },
	{ key: 'st', label: 'PPG (S/T)' },
]

const PPG_ROW_COUNT = PPG_ROWS.length
const METRIC_LABELS = {
	tt: 'PPG (TT)',
	ha: 'PPG (H/A)',
	ht: 'PPG (H/T)',
	st: 'PPG (S/T)',
}

let mainPpgMetric = 'tt'
let htPpgMetric = 'ht'
let stPpgMetric = 'st'

const ppgMainInput = document.getElementById('ppg-main')
const ppgHtInput = document.getElementById('ppg-ht')
const ppgStInput = document.getElementById('ppg-st')
const ppgMetricLabel = document.getElementById('ppg-metric-label')
const ppgMetricDropdown = document.getElementById('ppg-metric-dropdown')
const btnPpgMetric = document.getElementById('btn-ppg-metric')

function parseFilterValue(input) {
	const v = parseFloat(String(input?.value || '').replace(',', '.'))
	return Number.isFinite(v) && v > 0 ? v : 0
}

function getPpgGapNum(match, key) {
	const row = match.ppg?.[key]
	if (!row) return 0
	if (row.gapNum != null) return row.gapNum
	const g = parseFloat(row.gap)
	return Number.isFinite(g) ? g : 0
}

function passesPpgFilters(match) {
	const mainMin = parseFilterValue(ppgMainInput)
	const htMin = parseFilterValue(ppgHtInput)
	const stMin = parseFilterValue(ppgStInput)

	if (mainMin > 0 && getPpgGapNum(match, mainPpgMetric) < mainMin) return false
	if (htMin > 0 && getPpgGapNum(match, htPpgMetric) < htMin) return false
	if (stMin > 0 && getPpgGapNum(match, stPpgMetric) < stMin) return false
	return true
}

function tourKey(match) {
	const tour = match.tour || match.round || 1
	return String(tour).match(/^\d+$/) ? parseInt(tour, 10) : tour
}

function groupMatchesByTour(matches) {
	const map = new Map()
	for (const m of matches) {
		const key = tourKey(m)
		if (!map.has(key)) map.set(key, [])
		map.get(key).push(m)
	}
	return [...map.entries()].sort((a, b) => {
		if (typeof a[0] === 'number' && typeof b[0] === 'number') return a[0] - b[0]
		return String(a[0]).localeCompare(String(b[0]))
	})
}

/** Группировка: лига (в порядке выбора) → туры → матчи */
function groupMatchesByLeagueAndTour(matches) {
	const leagues = new Map()

	for (const m of matches) {
		const lid = m.leagueId || m.leagueLabel || '_'
		if (!leagues.has(lid)) {
			leagues.set(lid, {
				label:
					m.leagueLabel ||
					(m.country && m.league ? `${m.country}: ${m.league}` : lid),
				tours: new Map(),
			})
		}
		const bucket = leagues.get(lid)
		const tk = tourKey(m)
		if (!bucket.tours.has(tk)) bucket.tours.set(tk, [])
		bucket.tours.get(tk).push(m)
	}

	const orderIndex = new Map(
		selectedLeagueOrder.map((id, i) => [id, i]),
	)
	const sortedLeagueIds = [...leagues.keys()].sort((a, b) => {
		const oa = orderIndex.has(a) ? orderIndex.get(a) : 99999
		const ob = orderIndex.has(b) ? orderIndex.get(b) : 99999
		return oa - ob
	})

	return sortedLeagueIds.map(lid => {
		const { label, tours } = leagues.get(lid)
		const sortedTours = [...tours.entries()].sort((a, b) => {
			if (typeof a[0] === 'number' && typeof b[0] === 'number') return a[0] - b[0]
			return String(a[0]).localeCompare(String(b[0]))
		})
		return { leagueId: lid, label, tours: sortedTours }
	})
}

function renderLeagueSection(section) {
	const toursHtml = section.tours
		.map(([tour, tourMatches]) => renderTourSection(tour, tourMatches))
		.join('')
	return `
	<section class="league-section" data-league="${escapeHtml(section.leagueId)}">
		<div class="league-header">${escapeHtml(section.label)}</div>
		${toursHtml}
	</section>`
}

function renderTourSection(tour, tourMatches) {
	const title =
		typeof tour === 'number' || /^\d+$/.test(String(tour))
			? `Тур ${tour}`
			: String(tour)
	return `
	<section class="tour-section" data-tour="${escapeHtml(tour)}">
		<div class="tour-header">${escapeHtml(title)}</div>
		${tourMatches.map(renderMatchBlock).join('')}
	</section>`
}

function parseRuDate(str) {
	if (!str) return null
	const [d, m, y] = str.split('.').map(Number)
	return new Date(y, m - 1, d)
}

function formatRuDate(date) {
	const d = String(date.getDate()).padStart(2, '0')
	const m = String(date.getMonth() + 1).padStart(2, '0')
	return `${d}.${m}.${date.getFullYear()}`
}

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function normalizePlayer(p) {
	if (!p || typeof p === 'string') {
		return { name: String(p || '—'), number: '?', goals: 0, role: 'starter' }
	}
	if (/^\d+$/.test(String(p.name)) && (!p.number || p.number === '?')) {
		return { name: '—', number: p.name, goals: 0, role: p.role || 'starter' }
	}
	const goals = p.goals != null ? p.goals : 0
	return {
		name: String(p.name).trim(),
		number: p.number || '?',
		goals,
		role: p.role || 'starter',
	}
}

function partitionLineup(players) {
	const list = (players || []).map(normalizePlayer)
	const subs = list.filter(p => p.role === 'sub')
	let starters = list.filter(p => p.role !== 'sub')

	if (subs.length > 0) return { starters, subs }

	if (starters.length > 11) {
		return { starters: starters.slice(0, 11), subs: starters.slice(11) }
	}

	return { starters, subs: [] }
}

function formatPlayer(p) {
	const pl = normalizePlayer(p)
	const num = pl.number && pl.number !== '?' ? `${pl.number}. ` : ''
	const g = pl.goals != null ? pl.goals : 0
	return `${num}${pl.name} (${g})`
}

function renderPlayerList(players) {
	return players
		.map(p => {
			const goalClass = (p.goals || 0) > 0 ? ' lineup-player-scored' : ''
			return `<span class="lineup-player${goalClass}">${escapeHtml(formatPlayer(p))}</span>`
		})
		.join('')
}

function renderLineupGrid(players) {
	const { starters, subs } = partitionLineup(players)
	if (!starters.length && !subs.length) {
		return '<span class="lineup-empty">—</span>'
	}

	const startersHtml = starters.length
		? `<div class="lineup-section"><div class="lineup-section-title">Старт</div><div class="lineup-players">${renderPlayerList(starters)}</div></div>`
		: ''
	const subsHtml = subs.length
		? `<div class="lineup-section"><div class="lineup-section-title">Запас</div><div class="lineup-players">${renderPlayerList(subs)}</div></div>`
		: ''

	return `<div class="lineup-grid expanded">${startersHtml}${subsHtml}</div>`
}

/** Счёт: (итог) счёт 1-го тайма | счёт 2-го тайма — как на Livescore */
function getHalfScores(match) {
	if (
		match.firstHalfHome != null &&
		match.firstHalfAway != null &&
		match.secondHalfHome != null &&
		match.secondHalfAway != null
	) {
		return {
			htH: match.firstHalfHome,
			htA: match.firstHalfAway,
			stH: match.secondHalfHome,
			stA: match.secondHalfAway,
		}
	}

	const parsed = match.scoreDisplay?.match(
		/\((\d+)-(\d+)\)\s+(\d+)-(\d+)\s+\|\s+(\d+)-(\d+)/,
	)
	if (parsed) {
		const parenH = +parsed[1]
		const parenA = +parsed[2]
		const midH = +parsed[3]
		const midA = +parsed[4]
		const stH = +parsed[5]
		const stA = +parsed[6]

		// Новый формат: (FT) HT | ST
		if (parenH === match.score1 && parenA === match.score2) {
			return { htH: midH, htA: midA, stH, stA }
		}
		// Старый формат: (HT) FT | ST
		if (midH === match.score1 && midA === match.score2) {
			return { htH: parenH, htA: parenA, stH, stA }
		}
	}

	const htH = 0
	const htA = 0
	return {
		htH,
		htA,
		stH: Math.max(0, match.score1 - htH),
		stA: Math.max(0, match.score2 - htA),
	}
}

function renderMatchBlock(match) {
	const openLink = match.url
		? `<a href="${escapeHtml(match.url)}" target="_blank" rel="noopener">Открыть &gt;</a>`
		: ''

	const ppgBody = PPG_ROWS.map((row, i) => {
		const ppg = match.ppg?.[row.key] || { home: '—', away: '—', gap: '—' }
		const lineupHome =
			i === 0
				? `<td class="lineup-cell" rowspan="${PPG_ROW_COUNT}">${renderLineupGrid(match.homeLineup)}</td>`
				: ''
		const lineupAway =
			i === 0
				? `<td class="lineup-cell" rowspan="${PPG_ROW_COUNT}">${renderLineupGrid(match.awayLineup)}</td>`
				: ''

		return `
		<tr class="data-row">
			<td class="ppg-label">${row.label}</td>
			<td class="num">${escapeHtml(ppg.home)}</td>
			<td class="num">${escapeHtml(ppg.away)}</td>
			<td class="num">${escapeHtml(ppg.gap)}</td>
			${lineupHome}
			${lineupAway}
		</tr>`
	}).join('')

	const status = match.status || 'finished'
	const statusText =
		{
			finished: 'Завершён',
			scheduled: 'Не начался',
			live: 'Идёт',
			postponed: 'Перенесён',
			cancelled: 'Отменён',
			unknown: 'Статус неизвестен',
		}[status] || status

	const showSync = status !== 'finished'
	const syncBtn = showSync
		? `<button type="button" class="btn-sync" data-match-id="${escapeHtml(match.id)}">Синхронизировать</button>`
		: ''

	let scoreCell
	const kickoff = match.time || ''
	
	if (status === 'scheduled' || status === 'live' || status === 'postponed' || status === 'cancelled') {
		// Предстоящий матч или перенесённый - показываем время
		if (kickoff) {
			scoreCell = `<th class="col-score wcl-cell_1y2-p match-upcoming-time">
				<span class="match-kickoff-icon">🕐</span>
				<span class="match-kickoff-text">${escapeHtml(kickoff)}</span>
			</th>`
		} else {
			scoreCell = `<th class="col-score wcl-cell_1y2-p match-upcoming-time">
				<span class="match-upcoming-label">Время неизвестно</span>
			</th>`
		}
	} else {
		// Завершённый матч - показываем счёт
		const { htH, htA, stH, stA } = getHalfScores(match)
		scoreCell = `<th class="col-score wcl-cell_1y2-p match-finished-score">
			<span class="score-cell">
				<span class="wcl-bold_NZXv6">(${escapeHtml(`${match.score1}-${match.score2}`)})</span>
				<span class="wcl-scores-overline-02_bpqU7"> ${escapeHtml(`${htH}-${htA}`)}</span>
				<span class="score-sep"> | </span>
				<span class="wcl-scores_Na715">${escapeHtml(`${stH}-${stA}`)}</span>
			</span>
		</th>`
	}

	return `
	<article class="match-block" data-id="${escapeHtml(match.id)}" data-date="${escapeHtml(match.calendarDate || match.date)}" data-status="${escapeHtml(status)}">
		<div class="match-league-bar">
			<span>${escapeHtml(match.leagueLabel || `${allData.meta.country}: ${allData.meta.league}`)}</span>
			<span class="match-status match-status-${escapeHtml(status)}">${escapeHtml(statusText)}</span>
			${syncBtn}
			${openLink}
		</div>
		<table class="match-table">
			<thead>
				<tr class="head-row">
					${scoreCell}
					<th class="col-team">${escapeHtml(match.homeTeam)}</th>
					<th class="col-team">${escapeHtml(match.awayTeam)}</th>
					<th class="col-gap">Разрыв</th>
					<th class="col-lineup">
						<div class="lineup-head">
							<span>Состав (${escapeHtml(match.homeTeam)})</span>
						</div>
					</th>
					<th class="col-lineup">
						<div class="lineup-head">
							<span>Состав (${escapeHtml(match.awayTeam)})</span>
						</div>
					</th>
				</tr>
			</thead>
			<tbody>${ppgBody}</tbody>
		</table>
	</article>`
}

function getFilteredMatches() {
	if (!selectedLeagueIds.size) return []
	let list = allData.matches.filter(
		m => !m.leagueId || selectedLeagueIds.has(m.leagueId),
	)
	if (selectedDate) {
		list = list.filter(
			m => (m.calendarDate || m.date) === selectedDate,
		)
	}
	list = list.filter(passesPpgFilters)
	return list
}

function leaguesQuery() {
	return selectedLeagueOrder.filter(id => selectedLeagueIds.has(id)).join(',')
}

function applyCalendarPayload(payload) {
	if (Array.isArray(payload)) {
		availableDates = payload
		calendarDays = new Map()
		for (const d of payload) {
			calendarDays.set(d, { date: d, total: 1, upcoming: 0, finished: 1 })
		}
		return
	}
	availableDates = payload.dates || []
	calendarDays = new Map()
	for (const day of payload.days || []) {
		calendarDays.set(day.date, day)
	}
}

async function reloadData() {
	const q = leaguesQuery()
	if (!q) {
		allData.matches = []
		availableDates = []
		calendarDays = new Map()
		return
	}
	
	showLoadingOverlay('Загрузка матчей...')
	
	try {
		const suffix = `?leagues=${encodeURIComponent(q)}`
		const [leagueRes, datesRes] = await Promise.all([
			fetch(`/api/league${suffix}`),
			fetch(`/api/dates${suffix}`),
		])
		const payload = await leagueRes.json()
		allData.matches = payload.matches || []
		allData.meta = payload.meta || {}
		if (payload.tree) allData.tree = payload.tree
		applyCalendarPayload(await datesRes.json())
	} finally {
		hideLoadingOverlay()
	}
}

function renderMatches() {
	const matches = getFilteredMatches()

	if (!selectedLeagueIds.size) {
		container.innerHTML = `
			<div class="empty-state">
				<p>Выберите лиги в фильтре «Страна» — по умолчанию ничего не загружается.</p>
				<p>Отметьте нужные сезоны, затем используйте календарь для просмотра матчей.</p>
			</div>`
		return
	}

	if (!allData.matches.length) {
		container.innerHTML = `
			<div class="empty-state">
				<p>Данные не загружены.</p>
				<p>Добавьте лигу в <code>data/leagues.config.json</code></p>
				<p>Запустите: <code>npm run preload-league -- eng-premier-2024</code></p>
			</div>`
		return
	}

	if (!matches.length) {
		const msg = !selectedLeagueIds.size
			? 'Выберите хотя бы одну лигу в фильтре «Страна»'
			: parseFilterValue(ppgMainInput) ||
				  parseFilterValue(ppgHtInput) ||
				  parseFilterValue(ppgStInput)
				? 'Нет матчей с выбранным разрывом PPG'
				: 'Нет матчей на выбранную дату'
		container.innerHTML = `<div class="empty-state">${msg}</div>`
		return
	}

	const sections = groupMatchesByLeagueAndTour(matches)
	container.innerHTML = sections.map(renderLeagueSection).join('')
	bindSyncButtons()
}

function getCountryTreeData() {
	return (allData.tree || []).map((group, idx) => {
		const allSeasons = (group.leagues || []).flatMap(l => l.seasons || [])
		const loadedSeasons = allSeasons.filter(s => s.loaded)
		return {
			id: `country-${group.country}`,
			name: group.country,
			expanded: idx === 0,
			checked:
				loadedSeasons.length > 0 &&
				loadedSeasons.every(s => selectedLeagueIds.has(s.id)),
			leagues: (group.leagues || []).map(lg => {
				const loaded = (lg.seasons || []).filter(s => s.loaded)
				return {
					id: `league-${group.country}-${lg.name}`,
					name: lg.name,
					expanded: false,
					checked:
						loaded.length > 0 &&
						loaded.every(s => selectedLeagueIds.has(s.id)),
					seasons: (lg.seasons || []).map(s => ({
						id: s.id,
						name: s.loaded ? s.season : `${s.season} (не загружена)`,
						checked: selectedLeagueIds.has(s.id),
						loaded: s.loaded,
					})),
				}
			}),
		}
	})
}

function renderCountryRow(item, level = 0) {
	const isSeason = level === 2
	const children = isSeason ? [] : level === 1 ? item.seasons || [] : item.leagues || []
	const hasChildren = children.length > 0
	const childrenId = `children-${item.id}`
	const indentClass =
		level === 1 ? ' tree-level-league' : level === 2 ? ' tree-level-season' : ''

	const expandBtn = hasChildren
		? `<button type="button" class="country-expand" data-target="${childrenId}" aria-label="Развернуть">${item.expanded ? '−' : '+'}</button>`
		: '<span class="country-expand placeholder" aria-hidden="true"> </span>'

	const childLevel = level + 1
	const childrenHtml = hasChildren
		? `<div class="country-children${item.expanded ? '' : ' collapsed'}" id="${childrenId}">
			${children.map(c => renderCountryRow(c, childLevel)).join('')}
		</div>`
		: ''

	let inputAttr = ''
	if (isSeason) {
		inputAttr = ` data-league-id="${escapeHtml(item.id)}"${item.loaded ? '' : ' disabled'}`
	} else if (level === 1) {
		const ids = (item.seasons || [])
			.filter(s => s.loaded)
			.map(s => s.id)
			.join(',')
		inputAttr = ` data-league-group="${escapeHtml(item.id)}" data-season-ids="${escapeHtml(ids)}"`
	} else {
		inputAttr = ` data-country-id="${escapeHtml(item.id)}"`
	}

	return `
		<div class="country-row${indentClass}" data-id="${escapeHtml(item.id)}">
			<label class="country-row-main">
				<input type="checkbox" id="chk-${escapeHtml(item.id)}" ${item.checked ? 'checked' : ''}${inputAttr} />
				<span>${escapeHtml(item.name)}</span>
			</label>
			${expandBtn}
		</div>
		${childrenHtml}`
}

async function onLeagueFilterChange() {
	await reloadData()
	renderCountryTree()
	if (availableDates.length) {
		const anchor =
			parseRuDate(selectedDate || availableDates[0]) || new Date()
		fillCalendarSelects(anchor)
	}
	renderCalendarGrid()
	if (dateLabel.textContent === 'Предстоящие') renderUpcomingMatches()
	else renderMatches()
}

function renderCountryTree() {
	const items = getCountryTreeData()
	if (!items.length) {
		countryTree.innerHTML =
			'<p class="country-tree-hint">Нет лиг в leagues.config.json</p>'
		return
	}

	countryTree.innerHTML = items.map(c => renderCountryRow(c)).join('')

	countryTree.querySelectorAll('input[data-league-id]').forEach(chk => {
		chk.addEventListener('change', async e => {
			const id = e.target.dataset.leagueId
			if (e.target.checked) addSelectedLeague(id)
			else removeSelectedLeague(id)
			await onLeagueFilterChange()
		})
	})

	countryTree.querySelectorAll('input[data-league-group]').forEach(chk => {
		chk.addEventListener('change', async e => {
			const ids = (e.target.dataset.seasonIds || '').split(',').filter(Boolean)
			setSelectedLeagues(ids, e.target.checked)
			await onLeagueFilterChange()
		})
	})

	countryTree.querySelectorAll('input[data-country-id]').forEach(chk => {
		chk.addEventListener('change', async e => {
			const countryId = e.target.dataset.countryId
			const group = getCountryTreeData().find(c => c.id === countryId)
			if (!group) return
			const ids = []
			for (const lg of group.leagues) {
				for (const s of lg.seasons) {
					if (s.loaded) ids.push(s.id)
				}
			}
			setSelectedLeagues(ids, e.target.checked)
			await onLeagueFilterChange()
		})
	})

	countryTree.querySelectorAll('.country-expand[data-target]').forEach(btn => {
		btn.addEventListener('click', e => {
			e.stopPropagation()
			const target = document.getElementById(btn.dataset.target)
			if (!target) return
			const collapsed = target.classList.toggle('collapsed')
			btn.textContent = collapsed ? '+' : '−'
		})
	})
}

function setCountryDropdownOpen(open) {
	countryDropdown.classList.toggle('hidden', !open)
	btnCountry.setAttribute('aria-expanded', open ? 'true' : 'false')
	if (open) calendarPopup.classList.add('hidden')
}

function initCountryDropdown() {
	btnCountry.addEventListener('click', e => {
		e.stopPropagation()
		const open = countryDropdown.classList.contains('hidden')
		setCountryDropdownOpen(open)
	})

	countryDropdown.addEventListener('click', e => e.stopPropagation())
}

function setMetricDropdownOpen(open) {
	ppgMetricDropdown?.classList.toggle('hidden', !open)
	btnPpgMetric?.setAttribute('aria-expanded', open ? 'true' : 'false')
	if (open) {
		calendarPopup.classList.add('hidden')
		setCountryDropdownOpen(false)
	}
}

function selectMainMetric(metric) {
	mainPpgMetric = metric
	updatePpgToggleButtons()
	renderMatches()
}

function initSubMetricDropdown({
	btnId,
	dropdownId,
	labelId,
	getMetric,
	setMetric,
}) {
	const btn = document.getElementById(btnId)
	const dropdown = document.getElementById(dropdownId)
	const label = document.getElementById(labelId)
	if (!btn || !dropdown) return

	const refresh = () => {
		const m = getMetric()
		if (label) label.textContent = METRIC_LABELS[m] || m
		dropdown.querySelectorAll('button').forEach(b => {
			b.classList.toggle('active', b.dataset.metric === m)
		})
	}

	dropdown.querySelectorAll('button').forEach(b => {
		b.addEventListener('click', e => {
			e.stopPropagation()
			setMetric(b.dataset.metric)
			dropdown.classList.add('hidden')
			refresh()
			renderMatches()
		})
	})

	btn.addEventListener('click', e => {
		e.stopPropagation()
		dropdown.classList.toggle('hidden')
		setMetricDropdownOpen(false)
		setCountryDropdownOpen(false)
	})

	dropdown.addEventListener('click', e => e.stopPropagation())
	refresh()
}

function initPpgFilters() {
	// Новый переключатель PPG (T/T) / PPG (H/A)
	document.querySelectorAll('.ppg-toggle-btn').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.metric === mainPpgMetric)
		btn.addEventListener('click', e => {
			e.stopPropagation()
			selectMainMetric(btn.dataset.metric)
		})
	})

	initSubMetricDropdown({
		btnId: 'btn-ppg-ht-metric',
		dropdownId: 'ppg-ht-metric-dropdown',
		labelId: 'ppg-ht-metric-label',
		getMetric: () => htPpgMetric,
		setMetric: m => {
			htPpgMetric = m
		},
	})

	initSubMetricDropdown({
		btnId: 'btn-ppg-st-metric',
		dropdownId: 'ppg-st-metric-dropdown',
		labelId: 'ppg-st-metric-label',
		getMetric: () => stPpgMetric,
		setMetric: m => {
			stPpgMetric = m
		},
	})

	ppgMainInput?.addEventListener('input', renderMatches)
	ppgHtInput?.addEventListener('input', renderMatches)
	ppgStInput?.addEventListener('input', renderMatches)
}

function updatePpgToggleButtons() {
	document.querySelectorAll('.ppg-toggle-btn').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.metric === mainPpgMetric)
	})
	if (ppgMetricLabel) ppgMetricLabel.textContent = METRIC_LABELS[mainPpgMetric] || mainPpgMetric
}

function fillCalendarSelects(date) {
	calDay.innerHTML = ''
	for (let d = 1; d <= 31; d++) {
		const opt = document.createElement('option')
		opt.value = d
		opt.textContent = String(d).padStart(2, '0')
		if (d === date.getDate()) opt.selected = true
		calDay.appendChild(opt)
	}

	calMonth.innerHTML = ''
	MONTHS_RU.forEach((name, i) => {
		const opt = document.createElement('option')
		opt.value = i
		opt.textContent = name
		if (i === date.getMonth()) opt.selected = true
		calMonth.appendChild(opt)
	})

	calYear.innerHTML = ''
	const years = new Set(
		availableDates.map(s => parseRuDate(s)?.getFullYear()).filter(Boolean),
	)
	if (!years.size) years.add(date.getFullYear())
	;[...years]
		.sort()
		.forEach(y => {
			const opt = document.createElement('option')
			opt.value = y
			opt.textContent = y
			if (y === date.getFullYear()) opt.selected = true
			calYear.appendChild(opt)
		})
}

function getTodayKey() {
	return formatRuDate(new Date())
}

function renderCalendarGrid() {
	const day = parseInt(calDay.value, 10)
	const month = parseInt(calMonth.value, 10)
	const year = parseInt(calYear.value, 10)

	const first = new Date(year, month, 1)
	const startDay = (first.getDay() + 6) % 7
	const daysInMonth = new Date(year, month + 1, 0).getDate()
	const todayKey = getTodayKey()

	calendarGrid.innerHTML = ''

	for (let i = 0; i < startDay; i++) {
		const empty = document.createElement('span')
		empty.className = 'empty'
		calendarGrid.appendChild(empty)
	}

	for (let d = 1; d <= daysInMonth; d++) {
		const cell = document.createElement('span')
		const ru = formatRuDate(new Date(year, month, d))
		cell.textContent = d

		const info = calendarDays.get(ru)
		if (info) {
			cell.classList.add('has-matches')
			cell.title = `${info.total} матч(ей): ${info.finished} сыграно, ${info.upcoming} предстоящих`
			if (info.upcoming > 0) cell.classList.add('has-upcoming')
			if (info.finished > 0 && info.upcoming === 0) {
				cell.classList.add('has-finished-only')
			}
		}
		if (selectedDate === ru) cell.classList.add('selected')
		if (ru === todayKey) cell.classList.add('is-today')

		const cellDate = parseRuDate(ru)
		if (cellDate && cellDate < new Date(todayKey.split('.').reverse().join('-'))) {
			if (!cell.classList.contains('has-upcoming')) cell.classList.add('is-past')
		}

		cell.addEventListener('click', () => {
			selectedDate = ru
			dateLabel.textContent = ru
			calendarPopup.classList.add('hidden')
			calDay.value = d
			renderCalendarGrid()
			renderMatches()
			const firstMatch = container.querySelector(`[data-date="${ru}"]`)
			firstMatch?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		})

		calendarGrid.appendChild(cell)
	}
}

function initCalendar() {
	const today = new Date()
	const todayKey = getTodayKey()

	selectedDate = null
	dateLabel.textContent = 'Все матчи'

	fillCalendarSelects(today)
	renderCalendarGrid()

	const resetBtn = document.getElementById('btn-reset-date')
	resetBtn?.addEventListener('click', () => {
		selectedDate = null
		dateLabel.textContent = 'Все матчи'
		renderCalendarGrid()
		renderMatches()
	})

	const upcomingBtn = document.getElementById('btn-upcoming-date')
	upcomingBtn?.addEventListener('click', () => {
		selectedDate = null
		dateLabel.textContent = 'Предстоящие'
		calendarPopup.classList.add('hidden')
		renderCalendarGrid()
		renderUpcomingMatches()
	})

	;[calDay, calMonth, calYear].forEach(el => {
		el.addEventListener('change', renderCalendarGrid)
	})
}

function renderUpcomingMatches() {
	const matches = allData.matches
		.filter(m => selectedLeagueIds.has(m.leagueId))
		.filter(m => m.status === 'scheduled' || m.status === 'live')
		.filter(passesPpgFilters)
		.sort((a, b) => {
			const da = parseRuDate(a.calendarDate || a.date)
			const db = parseRuDate(b.calendarDate || b.date)
			return (da?.getTime() || 0) - (db?.getTime() || 0)
		})

	if (!matches.length) {
		container.innerHTML =
			'<div class="empty-state">Нет предстоящих матчей в выбранных лигах</div>'
		return
	}

	const sections = groupMatchesByLeagueAndTour(matches)
	container.innerHTML = sections.map(renderLeagueSection).join('')
	bindSyncButtons()
}

function bindSyncButtons() {
	container.querySelectorAll('.btn-sync').forEach(btn => {
		btn.addEventListener('click', async () => {
			const id = btn.dataset.matchId
			btn.disabled = true
			btn.textContent = 'Синхронизация…'
			try {
				const res = await fetch(`/api/matches/${encodeURIComponent(id)}/sync`, {
					method: 'POST',
				})
				const data = await res.json()
				if (!res.ok) throw new Error(data.error || res.statusText)
				const idx = allData.matches.findIndex(m => m.id === id)
				if (idx >= 0) allData.matches[idx] = data.match
				await reloadData()
				if (dateLabel.textContent === 'Предстоящие') renderUpcomingMatches()
				else renderMatches()
			} catch (err) {
				alert(`Ошибка синхронизации: ${err.message}`)
				btn.disabled = false
				btn.textContent = 'Синхронизировать'
			}
		})
	})
}

/** Синхронизация всех матчей выбранных стран */
async function syncAllCountries() {
	if (!selectedLeagueIds.size) {
		alert('Выберите хотя бы одну лигу')
		return
	}

	const btn = document.getElementById('btn-sync-all-countries')
	if (btn) {
		btn.disabled = true
		btn.textContent = '⏳ Синхронизация...'
	}

	showLoadingOverlay('Синхронизация предстоящих матчей...')

	try {
		const upcomingMatches = allData.matches.filter(
			m => m.status === 'scheduled' || m.status === 'live'
		)

		let syncedCount = 0
		for (const match of upcomingMatches) {
			try {
				const res = await fetch(`/api/matches/${encodeURIComponent(match.id)}/sync`, {
					method: 'POST',
				})
				if (res.ok) {
					const data = await res.json()
					const idx = allData.matches.findIndex(m => m.id === match.id)
					if (idx >= 0) allData.matches[idx] = data.match
					syncedCount++
				}
			} catch (err) {
				console.error(`Ошибка синхронизации матча ${match.id}:`, err)
			}
			// Небольшая задержка между синхронизациями
			await new Promise(resolve => setTimeout(resolve, 200))
		}

		await reloadData()
		if (dateLabel.textContent === 'Предстоящие') renderUpcomingMatches()
		else renderMatches()

		alert(`Синхронизировано ${syncedCount} матчей`)
	} catch (err) {
		alert(`Ошибка синхронизации: ${err.message}`)
	} finally {
		hideLoadingOverlay()
		if (btn) {
			btn.disabled = false
			btn.textContent = '🔄 Синхронизировать страны'
		}
	}
}

document.getElementById('btn-date').addEventListener('click', e => {
	e.stopPropagation()
	const willOpen = calendarPopup.classList.contains('hidden')
	calendarPopup.classList.toggle('hidden')
	if (willOpen) setCountryDropdownOpen(false)
})

document.addEventListener('click', () => {
	calendarPopup.classList.add('hidden')
	setCountryDropdownOpen(false)
	setMetricDropdownOpen(false)
})

async function init() {
	showLoadingOverlay('Загрузка конфигурации...')
	
	try {
		const res = await fetch('/api/tree')
		const payload = await res.json()
		allData.tree = payload.tree || []
		allData.matches = []
	} catch (err) {
		hideLoadingOverlay()
		container.innerHTML = `<div class="empty-state">Ошибка загрузки: ${err.message}</div>`
		return
	}

	// Инициализация интерфейса
	renderCountryTree()
	initCountryDropdown()
	initPpgFilters()
	initCalendar()
	
	// Инициализация кнопки синхронизации стран
	const syncCountriesBtn = document.getElementById('btn-sync-all-countries')
	if (syncCountriesBtn) {
		syncCountriesBtn.addEventListener('click', syncAllCountries)
	}
	
	// Скрываем загруженный экран после инициализации
	hideLoadingOverlay()
	
	renderMatches()
}

init()
