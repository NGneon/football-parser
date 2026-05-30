/**
 * Статус матча для веб-интерфейса и синхронизации
 */

function detectStatusFromList(raw) {
	const stage = String(raw.statusStage || raw.stageText || '')
		.trim()
		.toLowerCase()
	if (stage) {
		if (/заверш|finished|^ft$|aet|пеналь/i.test(stage)) return 'finished'
		if (/перенос|postpon|delayed/i.test(stage)) return 'postponed'
		if (/отмен|cancel|abandon/i.test(stage)) return 'cancelled'
		if (/live|идёт|идет|in play|1-й|2-й.*тайм/i.test(stage)) {
			return 'live'
		}
		if (/^\d{1,2}:\d{2}$/.test(stage) || stage.includes(':')) {
			return 'scheduled'
		}
	}

	const hasScore =
		raw.score1 != null &&
		raw.score2 != null &&
		(raw.score1 > 0 || raw.score2 > 0 || raw.scoreFinished === true)

	if (hasScore) return 'finished'

	if (raw.matchTime && !raw.scoreFinished) return 'scheduled'

	return 'unknown'
}

function isFinished(match) {
	return match?.status === 'finished'
}

function statusLabel(status) {
	switch (status) {
		case 'finished':
			return 'Завершён'
		case 'scheduled':
			return 'Не начался'
		case 'live':
			return 'Идёт'
		case 'postponed':
			return 'Перенесён'
		case 'cancelled':
			return 'Отменён'
		default:
			return 'Статус неизвестен'
	}
}

module.exports = {
	detectStatusFromList,
	isFinished,
	statusLabel,
}
