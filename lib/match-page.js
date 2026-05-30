/**
 * Проверки страницы матча (evaluate в браузере)
 */

/** Есть вкладка «Сетка» — кубковая сетка, не парсим */
function hasBracketTabInPage() {
	const tabs = document.querySelectorAll('button[data-testid="wcl-tab"]')
	for (const tab of tabs) {
		const text = (tab.textContent || '').trim().toLowerCase()
		if (text === 'сетка' || text === 'bracket' || text === 'draw') {
			return true
		}
	}
	return false
}

module.exports = {
	hasBracketTabInPage,
}
