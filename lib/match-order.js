function parseRuDate(str) {
	if (!str) return 0
	const [d, m, y] = str.split('.').map(Number)
	if (!d || !m || !y) return 0
	return new Date(y, m - 1, d).getTime()
}

function tourSortKey(match) {
	const raw = match.tour ?? match.round ?? 0
	const n = parseInt(String(raw).replace(/\D/g, ''), 10)
	return Number.isFinite(n) && n > 0 ? n : 0
}

/** Сначала порядок лиг (как в фильтре), затем дата, затем тур */
function sortMatchesByLeagueOrder(matches, leagueIds) {
	const order = new Map((leagueIds || []).map((id, i) => [id, i]))

	return [...matches].sort((a, b) => {
		const oa = order.get(a.leagueId) ?? 99999
		const ob = order.get(b.leagueId) ?? 99999
		if (oa !== ob) return oa - ob

		const da = parseRuDate(a.date)
		const db = parseRuDate(b.date)
		if (da !== db) return da - db

		const ta = tourSortKey(a)
		const tb = tourSortKey(b)
		if (ta !== tb) return ta - tb

		return String(a.id || '').localeCompare(String(b.id || ''))
	})
}

module.exports = {
	parseRuDate,
	tourSortKey,
	sortMatchesByLeagueOrder,
}
