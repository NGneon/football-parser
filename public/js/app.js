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

let allData = { meta: {}, matches: [], tree: [] }
let availableDates = []
let selectedDate = null
/** id лиг из leagues.config.json, отмеченных в фильтре */
const selectedLeagueIds = new Set()
/** Порядок выбора лиг (Англия → Германия и т.д.) */
const selectedLeagueOrder = []

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
const expandedLineups = new Set()

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
		return { name: String(p || '—'), number: '?', goals: 0 }
	}
	if (/^\d+$/.test(String(p.name)) && (!p.number || p.number === '?')) {
		return { name: '—', number: p.name, goals: 0 }
	}
	const goals = p.goals != null ? p.goals : 0
	return {
		name: String(p.name).trim(),
		number: p.number || '?',
		goals,
	}
}

function formatPlayer(p) {
	const pl = normalizePlayer(p)
	const g = pl.goals != null ? pl.goals : 0
	return `${pl.name} (${g})`
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

function sortPlayersByGoals(players) {
	return [...players].sort((a, b) => {
		const dg = (b.goals || 0) - (a.goals || 0)
		if (dg !== 0) return dg
		return String(a.name).localeCompare(String(b.name), 'ru')
	})
}

function renderLineupGrid(players, matchId, side, expanded) {
	const list = sortPlayersByGoals((players || []).map(normalizePlayer))
	if (!list.length) {
		return '<span class="lineup-empty">—</span>'
	}
	const items = list
		.map(p => {
			const goalClass = (p.goals || 0) > 0 ? ' lineup-player-scored' : ''
			return `<span class="lineup-player${goalClass}">${escapeHtml(formatPlayer(p))}</span>`
		})
		.join('')
	return `<div class="lineup-grid${expanded ? ' expanded' : ''}" data-id="${matchId}" data-side="${side}">${items}</div>`
}

function renderMatchBlock(match) {
	const expandedHome = expandedLineups.has(`${match.id}-home`)
	const expandedAway = expandedLineups.has(`${match.id}-away`)
	const openLink = match.url
		? `<a href="${escapeHtml(match.url)}" target="_blank" rel="noopener">Открыть &gt;</a>`
		: ''

	const ppgBody = PPG_ROWS.map((row, i) => {
		const ppg = match.ppg?.[row.key] || { home: '—', away: '—', gap: '—' }
		const lineupHome =
			i === 0
				? `<td class="lineup-cell" rowspan="${PPG_ROW_COUNT}">${renderLineupGrid(match.homeLineup, match.id, 'home', expandedHome)}</td>`
				: ''
		const lineupAway =
			i === 0
				? `<td class="lineup-cell" rowspan="${PPG_ROW_COUNT}">${renderLineupGrid(match.awayLineup, match.id, 'away', expandedAway)}</td>`
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
	if (match.time) {
		scoreCell = `<th class="col-score wcl-cell_1y2-p">${escapeHtml(match.time)}</th>`
	} else {
		const { htH, htA, stH, stA } = getHalfScores(match)
		scoreCell = `<th class="col-score wcl-cell_1y2-p">
			<span class="score-cell">
				<span class="wcl-bold_NZXv6">(${escapeHtml(`${match.score1}-${match.score2}`)})</span>
				<span class="wcl-scores-overline-02_bpqU7"> ${escapeHtml(`${htH}-${htA}`)}</span>
				<span class="score-sep"> | </span>
				<span class="wcl-scores_Na715">${escapeHtml(`${stH}-${stA}`)}</span>
			</span>
		</th>`
	}

	return `
	<article class="match-block" data-id="${escapeHtml(match.id)}" data-date="${escapeHtml(match.date)}" data-status="${escapeHtml(status)}">
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
							<a href="#" class="show-all" data-id="${escapeHtml(match.id)}" data-side="home">Показать все</a>
						</div>
					</th>
					<th class="col-lineup">
						<div class="lineup-head">
							<span>Состав (${escapeHtml(match.awayTeam)})</span>
							<a href="#" class="show-all" data-id="${escapeHtml(match.id)}" data-side="away">Показать все</a>
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
		list = list.filter(m => m.date === selectedDate)
	}
	list = list.filter(passesPpgFilters)
	return list
}

function leaguesQuery() {
	return selectedLeagueOrder.filter(id => selectedLeagueIds.has(id)).join(',')
}

async function reloadData() {
	const q = leaguesQuery()
	const suffix = q ? `?leagues=${encodeURIComponent(q)}` : ''
	const [leagueRes, datesRes] = await Promise.all([
		fetch(`/api/league${suffix}`),
		fetch(`/api/dates${suffix}`),
	])
	const payload = await leagueRes.json()
	allData.matches = payload.matches || []
	allData.meta = payload.meta || {}
	if (payload.tree) allData.tree = payload.tree
	availableDates = await datesRes.json()
}

function renderMatches() {
	const matches = getFilteredMatches()

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

	container.querySelectorAll('.show-all').forEach(link => {
		link.addEventListener('click', e => {
			e.preventDefault()
			const key = `${link.dataset.id}-${link.dataset.side}`
			expandedLineups.add(key)
			renderMatches()
		})
	})

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
				renderMatches()
			} catch (err) {
				alert(`Ошибка синхронизации: ${err.message}`)
				btn.disabled = false
				btn.textContent = 'Синхронизировать'
			}
		})
	})
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
	renderMatches()
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
	if (ppgMetricLabel) ppgMetricLabel.textContent = METRIC_LABELS[metric] || metric
	ppgMetricDropdown?.querySelectorAll('button').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.metric === metric)
	})
	setMetricDropdownOpen(false)
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
	ppgMetricDropdown?.querySelectorAll('button').forEach(btn => {
		btn.classList.toggle('active', btn.dataset.metric === mainPpgMetric)
		btn.addEventListener('click', e => {
			e.stopPropagation()
			selectMainMetric(btn.dataset.metric)
		})
	})

	btnPpgMetric?.addEventListener('click', e => {
		e.stopPropagation()
		const open = ppgMetricDropdown.classList.contains('hidden')
		setMetricDropdownOpen(open)
	})

	ppgMetricDropdown?.addEventListener('click', e => e.stopPropagation())

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

function renderCalendarGrid() {
	const day = parseInt(calDay.value, 10)
	const month = parseInt(calMonth.value, 10)
	const year = parseInt(calYear.value, 10)

	const first = new Date(year, month, 1)
	const startDay = (first.getDay() + 6) % 7
	const daysInMonth = new Date(year, month + 1, 0).getDate()

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

		if (availableDates.includes(ru)) cell.classList.add('has-matches')
		if (selectedDate === ru) cell.classList.add('selected')

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
	const first =
		availableDates[0] ||
		(allData.matches[0] && allData.matches[0].date) ||
		formatRuDate(new Date())

	selectedDate = null
	const date = parseRuDate(first) || new Date()
	dateLabel.textContent = formatRuDate(date)

	fillCalendarSelects(date)
	renderCalendarGrid()

	const resetBtn = document.getElementById('btn-reset-date')
	resetBtn?.addEventListener('click', () => {
		selectedDate = null
		dateLabel.textContent = formatRuDate(date)
		renderCalendarGrid()
		renderMatches()
	})

	;[calDay, calMonth, calYear].forEach(el => {
		el.addEventListener('change', renderCalendarGrid)
	})
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
	try {
		const res = await fetch('/api/league')
		const payload = await res.json()
		allData.matches = payload.matches || []
		allData.meta = payload.meta || {}
		allData.tree = payload.tree || []

		for (const group of payload.tree || []) {
			if (group.country === 'Германия') continue
			for (const lg of group.leagues || []) {
				for (const s of lg.seasons || []) {
					if (s.loaded) addSelectedLeague(s.id)
				}
			}
		}

		const datesRes = await fetch(
			`/api/dates?leagues=${encodeURIComponent(leaguesQuery())}`,
		)
		availableDates = await datesRes.json()
	} catch (err) {
		container.innerHTML = `<div class="empty-state">Ошибка загрузки: ${err.message}</div>`
		return
	}

	renderCountryTree()
	initCountryDropdown()
	initPpgFilters()
	initCalendar()
	renderMatches()
}

init()
