/**
 * Нормализация даты и статуса матча для веб-интерфейса
 */
const { detectStatusFromList } = require('./match-status')

function extractTimeFromDate(dateStr) {
	if (!dateStr) return ''
	const m = String(dateStr).match(/\s(\d{1,2}:\d{2})\s*$/)
	return m ? m[1] : ''
}

function inferYearFromSeason(season, month) {
	const m = String(season || '').match(/(\d{4})\s*\/\s*(\d{4})/)
	if (!m) return new Date().getFullYear()
	const y1 = parseInt(m[1], 10)
	const y2 = parseInt(m[2], 10)
	if (month >= 8) return y1
	return y2
}

/** «11.04. 13:30» → «11.04.2026» для календаря и фильтра */
function normalizeCalendarDate(dateStr, season) {
	if (!dateStr) return ''
	let s = String(dateStr).trim().replace(/\s+\d{1,2}:\d{2}\s*$/, '').trim()

	const full = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
	if (full) {
		return `${full[1].padStart(2, '0')}.${full[2].padStart(2, '0')}.${full[3]}`
	}

	const partial = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/)
	if (!partial) return dateStr

	const day = parseInt(partial[1], 10)
	const month = parseInt(partial[2], 10)
	const year = inferYearFromSeason(season, month)
	return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
}

function inferMatchStatus(match) {
	if (match.status) return match.status

	if (match.scoreDisplay?.includes('(')) return 'finished'
	if (match.score1 > 0 || match.score2 > 0) return 'finished'
	if (match.homeGoals?.length || match.awayGoals?.length) return 'finished'

	const time = match.time || extractTimeFromDate(match.date)
	if (time && match.score1 === 0 && match.score2 === 0) return 'scheduled'

	return detectStatusFromList({
		score1: match.score1,
		score2: match.score2,
		matchTime: time,
		statusStage: match.statusStage || '',
		scoreFinished: match.scoreDisplay?.includes('(') || false,
	})
}

function enrichMatch(match, season) {
	const calendarDate = normalizeCalendarDate(match.date, season || match.season)
	const time = match.time || extractTimeFromDate(match.date)
	const status = inferMatchStatus(match)

	return {
		...match,
		calendarDate,
		time,
		status,
	}
}

function parseCalendarDate(str) {
	if (!str) return null
	const [d, m, y] = str.split('.').map(Number)
	if (!d || !m || !y) return null
	return new Date(y, m - 1, d)
}

function buildCalendarSummary(matches) {
	const byDate = new Map()

	for (const m of matches) {
		const key = m.calendarDate || m.date
		if (!key) continue
		if (!byDate.has(key)) {
			byDate.set(key, { date: key, total: 0, upcoming: 0, finished: 0 })
		}
		const info = byDate.get(key)
		info.total++
		if (m.status === 'scheduled' || m.status === 'live') info.upcoming++
		else info.finished++
	}

	const days = [...byDate.values()].sort((a, b) => {
		const da = parseCalendarDate(a.date)
		const db = parseCalendarDate(b.date)
		return (da?.getTime() || 0) - (db?.getTime() || 0)
	})

	return {
		dates: days.map(d => d.date),
		days,
	}
}

module.exports = {
	extractTimeFromDate,
	normalizeCalendarDate,
	inferMatchStatus,
	enrichMatch,
	buildCalendarSummary,
	parseCalendarDate,
}
