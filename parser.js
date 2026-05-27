const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')

const CONFIG = {
	seasons: (() => {
		const seasons = []
		// ТЕСТОВЫЙ РЕЖИМ: только сезон 2014-2015
		const startYear = 2014
		const endYear = 2014 // Только один сезон для теста

		for (let year = startYear; year <= endYear; year++) {
			const nextYear = year + 1
			seasons.push({
				seasonUrl: `https://www.livescore.in/ru/football/australia/a-league-${year}-${nextYear}/results/`,
				seasonName: `A_league_a${year}_${nextYear}`,
			})
		}

		return seasons
	})(),
	outputDir: './exports',
	headless: false, // Для теста лучше видеть что происходит
	concurrentMatches: 5, // Для теста один поток
}

if (!fs.existsSync(CONFIG.outputDir)) {
	fs.mkdirSync(CONFIG.outputDir, { recursive: true })
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

async function clickShowMoreButton(page) {
	const selectors = [
		'button.wcl-footer__button_OauhJ',
		'button[data-testid="wcl-buttonLink"]',
		'button:has-text("Показать больше матчей")',
		'button:has-text("Показать еще")',
		'button:has-text("Show more")',
		'button:has-text("Load more")',
		'.wcl-footer__button_OauhJ',
		'button[class*="footer__button"]',
		'button[class*="show-more"]',
		'.event__more',
		'button[data-testid="show-more"]',
		'button[class*="ShowMore"]',
		'div[class*="show-more"] button',
		'.pagination__load-more',
	]

	for (const selector of selectors) {
		try {
			const button = await page.$(selector)
			if (button && (await button.isVisible())) {
				console.log(`    🔄 Нажатие кнопки (селектор: ${selector})...`)
				await button.click()
				await sleep(2000)
				return true
			}
		} catch (err) {}
	}

	try {
		const buttons = await page.$$('button')
		for (const button of buttons) {
			const text = await button.textContent()
			if (
				text &&
				(text.includes('Показать больше матчей') ||
					text.includes('Show more') ||
					text.includes('Показать еще') ||
					text.includes('Load more'))
			) {
				if (await button.isVisible()) {
					console.log(`    🔄 Нажатие кнопки с текстом: "${text}"...`)
					await button.click()
					await sleep(2000)
					return true
				}
			}
		}
	} catch (err) {}

	return false
}

async function parseLineups(page, matchUrl) {
	try {
		// Сначала переходим на страницу summary
		console.log(`        📋 Переход на страницу матча: ${matchUrl}`)
		await page.goto(matchUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 15000,
		})
		await sleep(2000)

		// Ищем и кликаем на вкладку "Составы"
		console.log(`        🔍 Ищем вкладку "Составы"...`)

		const tabsSelectors = [
			'a[data-analytics-alias="lineups"]',
			'button[data-testid="wcl-tab"]:has-text("Составы")',
			'a:has-text("Составы")',
			'button:has-text("Составы")',
			'[role="tab"]:has-text("Составы")',
			'a[href*="lineups"]',
		]

		let clicked = false
		for (const selector of tabsSelectors) {
			try {
				const tab = await page.$(selector)
				if (tab && (await tab.isVisible())) {
					console.log(`        ✅ Найдена вкладка, кликаем...`)
					await tab.click()
					clicked = true
					await sleep(2000)
					break
				}
			} catch (err) {
				// продолжаем поиск
			}
		}

		// Если не нашли кнопку, пробуем сформировать URL вручную
		if (!clicked) {
			console.log(
				`        ⚠️ Не найдена вкладка, пробуем прямой переход по URL...`,
			)

			// Формируем правильный URL для страницы составов
			// Пример: /summary/ -> /lineups/
			let lineupsUrl = matchUrl.replace('/summary/', '/lineups/')

			// Добавляем параметр mid, если его нет
			if (!lineupsUrl.includes('?mid=')) {
				// Извлекаем ID матча из URL
				const matchIdMatch = matchUrl.match(/\/([^\/]+)\/?$/)
				if (matchIdMatch) {
					const matchId = matchIdMatch[1]
					lineupsUrl =
						lineupsUrl +
						(lineupsUrl.includes('?') ? '&' : '?') +
						`mid=${matchId}`
				}
			}

			console.log(`        📋 Переход по URL: ${lineupsUrl}`)
			await page.goto(lineupsUrl, {
				waitUntil: 'networkidle',
				timeout: 15000,
			})
			await sleep(2000)
		}

		// Ждем загрузки составов
		await page
			.waitForSelector(
				'.lf__sidesBox, .lf__sides, [data-testid*="lineupsParticipantGeneral"]',
				{
					timeout: 10000,
				},
			)
			.catch(() => {
				console.log(`        ⚠️ Не дождались загрузки составов`)
			})

		await sleep(2000)

		// Парсим составы
		const lineupsData = await page.evaluate(() => {
			const result = {
				homeTeam: '',
				awayTeam: '',
				homePlayers: [],
				awayPlayers: [],
			}

			// Получаем названия команд из заголовка страницы
			const pageTitle = document.title
			const titleMatch = pageTitle.match(/(.+?)\s*[-–]\s*(.+?)\s*[-–]/)
			if (titleMatch) {
				result.homeTeam = titleMatch[1].trim()
				result.awayTeam = titleMatch[2].trim()
			}

			// Ищем все элементы с игроками
			const leftPlayers = document.querySelectorAll(
				'[data-testid*="lineupsParticipantGeneral-left"]',
			)
			const rightPlayers = document.querySelectorAll(
				'[data-testid*="lineupsParticipantGeneral-right"]',
			)

			// Функция извлечения имени игрока
			const extractPlayerName = element => {
				// Ищем span с именем
				const nameSpan = element.querySelector(
					'.wcl-name_ZggyJ, .wcl-name_jjfMf, [data-testid="wcl-scores-simple-text-01"]',
				)
				if (nameSpan) {
					let name = nameSpan.innerText.trim()
					// Убираем роль в скобках
					name = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
					return name
				}

				// Ищем ссылку на игрока
				const playerLink = element.querySelector('a[href*="/player/"]')
				if (playerLink) {
					let name = playerLink.innerText.trim()
					name = name.replace(/\s*\([^)]*\)\s*$/, '').trim()
					return name
				}

				return ''
			}

			// Собираем игроков слева (домашняя команда)
			for (const playerEl of leftPlayers) {
				const playerName = extractPlayerName(playerEl)
				if (
					playerName &&
					playerName.length > 1 &&
					result.homePlayers.length < 11
				) {
					result.homePlayers.push(playerName)
				}
			}

			// Собираем игроков справа (гостевая команда)
			for (const playerEl of rightPlayers) {
				const playerName = extractPlayerName(playerEl)
				if (
					playerName &&
					playerName.length > 1 &&
					result.awayPlayers.length < 11
				) {
					result.awayPlayers.push(playerName)
				}
			}

			// Если не нашли через data-testid, пробуем через .lf__participantNew
			if (result.homePlayers.length === 0 && result.awayPlayers.length === 0) {
				const allParticipants = document.querySelectorAll('.lf__participantNew')

				for (const participant of allParticipants) {
					const isReversed = participant.classList.contains('lf__isReversed')
					const playerName = extractPlayerName(participant)

					if (playerName && playerName.length > 1) {
						if (!isReversed && result.homePlayers.length < 11) {
							result.homePlayers.push(playerName)
						} else if (isReversed && result.awayPlayers.length < 11) {
							result.awayPlayers.push(playerName)
						}
					}
				}
			}

			// Если все еще нет игроков, ищем через .wcl-participant_v7u5b
			if (result.homePlayers.length === 0 && result.awayPlayers.length === 0) {
				const allPlayers = document.querySelectorAll('.wcl-participant_v7u5b')

				for (const player of allPlayers) {
					const isLeft = player.getAttribute('data-testid')?.includes('-left')
					const isRight = player.getAttribute('data-testid')?.includes('-right')
					const playerName = extractPlayerName(player)

					if (playerName && playerName.length > 1) {
						if (isLeft && result.homePlayers.length < 11) {
							result.homePlayers.push(playerName)
						} else if (isRight && result.awayPlayers.length < 11) {
							result.awayPlayers.push(playerName)
						}
					}
				}
			}

			console.log(
				`Найдено домашних: ${result.homePlayers.length}, гостевых: ${result.awayPlayers.length}`,
			)

			return result
		})

		console.log(
			`        ✅ Составы: ${lineupsData.homeTeam || '?'} - ${lineupsData.homePlayers.length} игроков, ${lineupsData.awayTeam || '?'} - ${lineupsData.awayPlayers.length} игроков`,
		)

		// Выводим первых 5 игроков для проверки
		if (lineupsData.homePlayers.length > 0) {
			console.log(
				`        🏠 Домашние: ${lineupsData.homePlayers.slice(0, 5).join(', ')}...`,
			)
		}
		if (lineupsData.awayPlayers.length > 0) {
			console.log(
				`        🚌 Гостевые: ${lineupsData.awayPlayers.slice(0, 5).join(', ')}...`,
			)
		}

		// Если игроки не найдены, делаем скриншот для отладки
		if (
			lineupsData.homePlayers.length === 0 &&
			lineupsData.awayPlayers.length === 0
		) {
			console.log(`        ⚠️  Не удалось найти составы`)
			try {
				const screenshotPath = path.join(
					CONFIG.outputDir,
					`debug_lineups_${Date.now()}.png`,
				)
				await page.screenshot({ path: screenshotPath, fullPage: false })
				console.log(`        📸 Скриншот сохранен: ${screenshotPath}`)

				// Выводим URL для отладки
				console.log(`        🔗 Текущий URL: ${page.url()}`)
			} catch (e) {}
		}

		return lineupsData
	} catch (error) {
		console.log(`        ⚠️ Ошибка при парсинге составов: ${error.message}`)
		return {
			homeTeam: '',
			awayTeam: '',
			homePlayers: [],
			awayPlayers: [],
		}
	}
}

async function parseMatchDetails(page, matchUrl, match) {
	try {
		await page.goto(matchUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 15000,
		})
		await sleep(2000)

		const score1 = match.score1
		const score2 = match.score2

		const parsedData = await page.evaluate(
			matchData => {
				const matchScore1 = matchData.score1
				const matchScore2 = matchData.score2

				let firstHalfHome = 0,
					firstHalfAway = 0
				let secondHalfHome = 0,
					secondHalfAway = 0

				// храним ВСЕ голы как отдельные события (только не автоголы)
				const homeGoals = [] // [{ name: string, minute: number }]
				const awayGoals = [] // [{ name: string, minute: number }]

				// ========== 1. ПАРСИМ ГОЛЫ ПО ТАЙМАМ ИЗ СЕКЦИЙ ==========
				const sections = document.querySelectorAll('.wclHeaderSection--summary')

				for (let i = 0; i < sections.length; i++) {
					const section = sections[i]
					const titleSpan = section.querySelector(
						'.wcl-scores-overline-02_bpqU7',
					)
					let title = titleSpan ? titleSpan.innerText.trim() : ''

					const scoreSpans = section.querySelectorAll('.wcl-scores_Na715')
					let scoreText = ''
					if (scoreSpans.length >= 2) {
						scoreText = scoreSpans[1].innerText.trim()
					}

					if (!scoreText) {
						const allText = section.innerText
						const scoreMatch = allText.match(/(\d+)\s*[-:]\s*(\d+)/)
						if (scoreMatch) scoreText = scoreMatch[0]
					}

					const scoreMatch = scoreText.match(/(\d+)\s*[-:]\s*(\d+)/)
					if (scoreMatch) {
						const homeScore = parseInt(scoreMatch[1])
						const awayScore = parseInt(scoreMatch[2])

						if (
							title.includes('1-й') ||
							title.includes('1st') ||
							title.includes('HT')
						) {
							firstHalfHome = homeScore
							firstHalfAway = awayScore
						} else if (
							title.includes('2-й') ||
							title.includes('2nd') ||
							title.includes('FT')
						) {
							secondHalfHome = homeScore
							secondHalfAway = awayScore
						}
					}
				}

				// ========== 2. УЛУЧШЕННЫЙ ПАРСИНГ БОМБАРДИРОВ (ИГНОРИРУЕМ АВТОГОЛЫ) ==========

				function extractPlayerName(text, minute) {
					let cleaned = text.replace(new RegExp(`${minute}'`), '').trim()
					cleaned = cleaned
						.replace(
							/(гол|goal|пенальти|penalty|\(пенальти\)|\(penalty\))/gi,
							'',
						)
						.trim()
					cleaned = cleaned.replace(/[()]/g, '').trim()
					return cleaned
				}

				// Функция для проверки, является ли событие автоголом
				function isOwnGoal(eventElement) {
					// Проверяем наличие иконки автогола
					const ownGoalIcon = eventElement.querySelector(
						'.footballOwnGoal-ico, [class*="ownGoal"], svg[class*="ownGoal"], [data-testid*="ownGoal"]',
					)

					if (ownGoalIcon) {
						return true
					}

					// Проверяем текст на наличие упоминания автогола
					const eventText = eventElement.innerText.toLowerCase()
					if (
						eventText.includes('автогол') ||
						eventText.includes('own goal') ||
						eventText.includes('own-goal')
					) {
						return true
					}

					// Проверяем классы элемента
					const classes = eventElement.className
					if (
						typeof classes === 'string' &&
						(classes.includes('ownGoal') || classes.includes('own-goal'))
					) {
						return true
					}

					return false
				}

				let incidents = []

				const possibleSelectors = [
					'.smv__incident',
					'[data-testid*="incident"]',
					'.incident',
					'.event',
					'.goal-event',
					'[class*="incident"]',
					'[class*="goal"]',
				]

				for (const selector of possibleSelectors) {
					const elements = document.querySelectorAll(selector)
					if (elements.length > 0) {
						incidents = elements
						break
					}
				}

				const eventRows = document.querySelectorAll(
					'.smv__row, .event-row, [class*="eventRow"], [class*="match-event"]',
				)

				const allEvents = [...incidents, ...eventRows]
				const processedEvents = new Set()

				for (const event of allEvents) {
					const eventHtml = event.outerHTML
					const eventText = event.innerText

					let minute = null
					let timeElement = event.querySelector(
						'.smv__timeBox, .time, [class*="time"], [class*="minute"]',
					)

					if (timeElement) {
						const timeText = timeElement.innerText.trim()
						const minuteMatch = timeText.match(/(\d+)/)
						if (minuteMatch) minute = parseInt(minuteMatch[1])
					}

					if (!minute) {
						const timeMatch = eventText.match(/(\d+)'/)
						if (timeMatch) minute = parseInt(timeMatch[1])
					}

					if (!minute) continue

					const isGoal =
						eventHtml.includes('goal') ||
						eventHtml.includes('Goal') ||
						eventHtml.includes('гол') ||
						eventHtml.toLowerCase().includes('goal') ||
						eventHtml.includes('penalty') ||
						eventText.toLowerCase().includes('гол') ||
						eventText.toLowerCase().includes('goal') ||
						event.querySelector('[class*="goal"]') !== null ||
						event.querySelector('[data-testid*="goal"]') !== null

					if (!isGoal) continue

					// ПРОВЕРКА НА АВТОГОЛ - если это автогол, пропускаем
					if (isOwnGoal(event)) {
						console.log(`        ⚠️  Пропущен автогол на ${minute}' минуте`)
						continue
					}

					const eventKey = `${minute}-${eventText.substring(0, 50)}`
					if (processedEvents.has(eventKey)) continue
					processedEvents.add(eventKey)

					let isHome = false
					let isAway = false

					const parentHtml = event.parentElement?.outerHTML || ''
					const eventClasses = event.className

					if (
						event.closest('[class*="home"], [class*="left"]') !== null ||
						eventHtml.includes('home') ||
						parentHtml.includes('home')
					) {
						isHome = true
					} else if (
						event.closest('[class*="away"], [class*="right"]') !== null ||
						eventHtml.includes('away') ||
						parentHtml.includes('away')
					) {
						isAway = true
					}

					if (!isHome && !isAway) {
						const allRows = document.querySelectorAll('.smv__row, .event-row')
						let foundIndex = -1
						for (let i = 0; i < allRows.length; i++) {
							if (allRows[i] === event || allRows[i].contains(event)) {
								foundIndex = i
								break
							}
						}
						if (foundIndex !== -1) {
							isHome = foundIndex % 2 === 0
							isAway = foundIndex % 2 === 1
						}
					}

					let playerName = ''

					const playerLink = event.querySelector(
						'a[href*="/player/"], a[class*="player"], .smv__playerName, [class*="playerName"]',
					)
					if (playerLink) {
						playerName = playerLink.innerText.trim()
					}

					if (!playerName) {
						const nameElement = event.querySelector(
							'[class*="name"], [class*="player"], [class*="scorer"]',
						)
						if (nameElement) {
							playerName = nameElement.innerText.trim()
						}
					}

					if (!playerName) {
						const textWithoutTime = eventText
							.replace(new RegExp(`${minute}'`), '')
							.trim()
						const nameMatch = textWithoutTime.match(
							/[A-Za-zА-Яа-я][A-Za-zА-Яа-я\s\.\-]+?(?=\s|\(|$)/,
						)
						if (nameMatch) {
							playerName = nameMatch[0].trim()
							playerName = playerName
								.replace(/(гол|goal|пенальти|penalty)/gi, '')
								.trim()
						}
					}

					// добавляем КАЖДЫЙ гол как отдельное событие (только не автоголы)
					if (playerName && playerName.length > 1) {
						const isFirstHalf = minute <= 45

						if (isHome) {
							homeGoals.push({
								name: playerName,
								minute: minute,
							})

							if (isFirstHalf) {
								firstHalfHome++
							} else {
								secondHalfHome++
							}
						} else if (isAway) {
							awayGoals.push({
								name: playerName,
								minute: minute,
							})

							if (isFirstHalf) {
								firstHalfAway++
							} else {
								secondHalfAway++
							}
						}
					}
				}

				if (
					homeGoals.length === 0 &&
					awayGoals.length === 0 &&
					(matchScore1 > 0 || matchScore2 > 0)
				) {
					const pageText = document.body.innerText

					const goalPatterns = [
						/(\d+)'\s*([A-Za-zА-Яа-я][A-Za-zА-Яа-я\s\.\-]+?)\s*(?:\(пенальти\)|\(penalty\))?\s*(?:гол|goal)/gi,
						/(\d+)'\s*([A-Za-zА-Яа-я][A-Za-zА-Яа-я\s\.\-]+?)\s*(?:гол|goal)/gi,
						/([A-Za-zА-Яа-я][A-Za-zА-Яа-я\s\.\-]+?)\s*(\d+)'\s*(?:гол|goal)/gi,
					]

					let foundGoals = []
					for (const pattern of goalPatterns) {
						let match
						while ((match = pattern.exec(pageText)) !== null) {
							let minute, name
							if (match[1].match(/^\d+$/)) {
								minute = parseInt(match[1])
								name = match[2]
							} else if (match[2] && match[2].match(/^\d+$/)) {
								minute = parseInt(match[2])
								name = match[1]
							}

							if (minute && name && name.length > 1) {
								foundGoals.push({ minute, name: name.trim() })
							}
						}
					}

					const uniqueGoals = []
					const goalKeys = new Set()
					for (const goal of foundGoals) {
						const key = `${goal.minute}-${goal.name}`
						if (!goalKeys.has(key)) {
							goalKeys.add(key)
							uniqueGoals.push(goal)
						}
					}

					const homePlayers = new Set()
					const awayPlayers = new Set()

					const teamSections = document.querySelectorAll(
						'.wcl-participantName, .team-name, [class*="participant"]',
					)
					let homeTeamText = '',
						awayTeamText = ''

					for (const section of teamSections) {
						const text = section.innerText
						if (
							text.includes(matchData.team1) ||
							matchData.team1.includes(text)
						) {
							homeTeamText = text
						}
						if (
							text.includes(matchData.team2) ||
							matchData.team2.includes(text)
						) {
							awayTeamText = text
						}
					}

					const playerElements = document.querySelectorAll(
						'.smv__playerName, a[href*="/player/"], [class*="playerName"]',
					)
					for (const playerEl of playerElements) {
						const playerName = playerEl.innerText.trim()
						const parent = playerEl.closest('[class*="home"], [class*="left"]')
						if (parent) {
							homePlayers.add(playerName)
						} else {
							const parentAway = playerEl.closest(
								'[class*="away"], [class*="right"]',
							)
							if (parentAway) {
								awayPlayers.add(playerName)
							}
						}
					}

					for (const goal of uniqueGoals) {
						const isHomePlayer = Array.from(homePlayers).some(
							p => goal.name.includes(p) || p.includes(goal.name),
						)
						const isAwayPlayer = Array.from(awayPlayers).some(
							p => goal.name.includes(p) || p.includes(goal.name),
						)

						const isFirstHalf = goal.minute <= 45

						if (isHomePlayer) {
							homeGoals.push({
								name: goal.name,
								minute: goal.minute,
							})
							if (isFirstHalf) firstHalfHome++
							else secondHalfHome++
						} else if (isAwayPlayer) {
							awayGoals.push({
								name: goal.name,
								minute: goal.minute,
							})
							if (isFirstHalf) firstHalfAway++
							else secondHalfAway++
						}
					}
				}

				if (
					firstHalfHome === 0 &&
					firstHalfAway === 0 &&
					secondHalfHome === 0 &&
					secondHalfAway === 0
				) {
					if (matchScore1 > 0 || matchScore2 > 0) {
						secondHalfHome = matchScore1
						secondHalfAway = matchScore2
					}
				}

				return {
					firstHalf: { home: firstHalfHome, away: firstHalfAway },
					secondHalf: { home: secondHalfHome, away: secondHalfAway },
					homeGoals: homeGoals,
					awayGoals: awayGoals,
				}
			},
			{ score1, score2, team1: match.team1, team2: match.team2 },
		)

		const firstHalfGoalsHome = parsedData.firstHalf.home
		const firstHalfGoalsAway = parsedData.firstHalf.away
		const secondHalfGoalsHome = parsedData.secondHalf.home
		const secondHalfGoalsAway = parsedData.secondHalf.away

		const firstHalfHomeWin = firstHalfGoalsHome > firstHalfGoalsAway ? 1 : 0
		const firstHalfHomeDraw = firstHalfGoalsHome === firstHalfGoalsAway ? 1 : 0
		const firstHalfHomeLoss = firstHalfGoalsHome < firstHalfGoalsAway ? 1 : 0

		const secondHalfHomeWin = secondHalfGoalsHome > secondHalfGoalsAway ? 1 : 0
		const secondHalfHomeDraw =
			secondHalfGoalsHome === secondHalfGoalsAway ? 1 : 0
		const secondHalfHomeLoss = secondHalfGoalsHome < secondHalfGoalsAway ? 1 : 0

		return {
			firstHalfWins: firstHalfHomeWin,
			firstHalfDraws: firstHalfHomeDraw,
			firstHalfLosses: firstHalfHomeLoss,
			secondHalfWins: secondHalfHomeWin,
			secondHalfDraws: secondHalfHomeDraw,
			secondHalfLosses: secondHalfHomeLoss,
			firstHalfWinsAway: firstHalfHomeLoss,
			firstHalfDrawsAway: firstHalfHomeDraw,
			firstHalfLossesAway: firstHalfHomeWin,
			secondHalfWinsAway: secondHalfHomeLoss,
			secondHalfDrawsAway: secondHalfHomeDraw,
			secondHalfLossesAway: secondHalfHomeWin,
			firstHalfGoalsHome: firstHalfGoalsHome,
			firstHalfGoalsAway: firstHalfGoalsAway,
			secondHalfGoalsHome: secondHalfGoalsHome,
			secondHalfGoalsAway: secondHalfGoalsAway,
			homeGoals: parsedData.homeGoals,
			awayGoals: parsedData.awayGoals,
		}
	} catch (error) {
		console.log(`        ⚠️  Ошибка: ${error.message}`)
		return {
			firstHalfWins: 0,
			firstHalfDraws: 0,
			firstHalfLosses: 0,
			secondHalfWins: 0,
			secondHalfDraws: 0,
			secondHalfLosses: 0,
			firstHalfWinsAway: 0,
			firstHalfDrawsAway: 0,
			firstHalfLossesAway: 0,
			secondHalfWinsAway: 0,
			secondHalfDrawsAway: 0,
			secondHalfLossesAway: 0,
			firstHalfGoalsHome: 0,
			firstHalfGoalsAway: 0,
			secondHalfGoalsHome: 0,
			secondHalfGoalsAway: 0,
			homeGoals: [],
			awayGoals: [],
		}
	}
}

async function parseMatchesParallel(matches, context) {
	const results = []
	const batchSize = CONFIG.concurrentMatches

	for (let i = 0; i < matches.length; i += batchSize) {
		const batch = matches.slice(i, i + batchSize)
		const batchPromises = batch.map(async (match, idx) => {
			const page = await context.newPage()
			try {
				console.log(
					`    [${i + idx + 1}/${matches.length}] ${match.matchDate}: ${match.team1} vs ${match.team2}`,
				)
				const halfDetails = await parseMatchDetails(page, match.url, match)

				// Парсим составы
				const lineupsData = await parseLineups(page, match.url)
				match.homeTeamLineup = lineupsData.homeTeam || match.team1
				match.awayTeamLineup = lineupsData.awayTeam || match.team2
				match.homePlayers = lineupsData.homePlayers
				match.awayPlayers = lineupsData.awayPlayers

				await page.close()
				return { match, halfDetails }
			} catch (err) {
				await page.close()
				return {
					match,
					halfDetails: {
						firstHalfWins: 0,
						firstHalfDraws: 0,
						firstHalfLosses: 0,
						secondHalfWins: 0,
						secondHalfDraws: 0,
						secondHalfLosses: 0,
						firstHalfWinsAway: 0,
						firstHalfDrawsAway: 0,
						firstHalfLossesAway: 0,
						secondHalfWinsAway: 0,
						secondHalfDrawsAway: 0,
						secondHalfLossesAway: 0,
						firstHalfGoalsHome: 0,
						firstHalfGoalsAway: 0,
						secondHalfGoalsHome: 0,
						secondHalfGoalsAway: 0,
						homeGoals: [],
						awayGoals: [],
					},
				}
			}
		})

		const batchResults = await Promise.all(batchPromises)
		results.push(...batchResults)
	}

	return results
}

function parseMatchDate(dateStr) {
	if (!dateStr || dateStr === 'Н/Д') return new Date(0)

	const parts = dateStr.split('.')
	if (parts.length === 3) {
		const day = parseInt(parts[0])
		const month = parseInt(parts[1]) - 1
		const year = parseInt(parts[2])
		return new Date(year, month, day)
	}

	return new Date(0)
}

async function parseSeasonResults(seasonConfig) {
	console.log(`\n📅 Парсинг: ${seasonConfig.seasonName}`)

	const browser = await chromium.launch({
		headless: CONFIG.headless,
		args: [
			'--disable-blink-features=AutomationControlled',
			'--disable-dev-shm-usage',
			'--no-sandbox',
			'--disable-images',
		],
	})

	const context = await browser.newContext({
		userAgent:
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		viewport: { width: 1280, height: 800 },
	})

	const page = await context.newPage()

	try {
		console.log(`  🔗 Загрузка: ${seasonConfig.seasonUrl}`)

		await page.goto(seasonConfig.seasonUrl, {
			waitUntil: 'domcontentloaded',
			timeout: 30000,
		})

		await sleep(3000)

		console.log('  📜 Загрузка всех матчей...')

		let previousCount = 0
		let noChangeCount = 0
		let maxNoChange = 15
		let maxClicks = 30
		let clickCount = 0

		while (clickCount < maxClicks) {
			const currentCount = await page.$$eval(
				'.event__match, .event__match--last, [class*="event__match"]',
				els => els.length,
			)
			console.log(`    Текущее количество матчей: ${currentCount}`)

			const buttonClicked = await clickShowMoreButton(page)

			if (!buttonClicked) {
				if (noChangeCount >= maxNoChange) {
					console.log(
						`    Кнопка не найдена и матчи не загружаются. Останавливаем загрузку.`,
					)
					break
				}

				await page.evaluate(() => window.scrollBy(0, window.innerHeight))
				await sleep(1000)

				const newCount = await page.$$eval(
					'.event__match, .event__match--last, [class*="event__match"]',
					els => els.length,
				)
				if (newCount === currentCount) {
					noChangeCount++
				} else {
					noChangeCount = 0
					previousCount = newCount
				}
			} else {
				clickCount++
				noChangeCount = 0
				await sleep(2000)

				const newCount = await page.$$eval(
					'.event__match, .event__match--last, [class*="event__match"]',
					els => els.length,
				)
				if (newCount === previousCount && previousCount > 0) {
					console.log(
						`    Количество матчей не изменилось после нажатия кнопки. Возможно, все матчи загружены.`,
					)
					break
				}
				previousCount = newCount
			}
		}

		console.log('    Финальная прокрутка страницы...')
		for (let i = 0; i < 10; i++) {
			await page.evaluate(() => window.scrollBy(0, window.innerHeight))
			await sleep(500)
		}

		const finalCount = await page.$$eval(
			'.event__match, .event__match--last, [class*="event__match"]',
			els => els.length,
		)
		console.log('  ✅ Страница полностью загружена')
		console.log(`  📊 Всего загружено матчей: ${finalCount}`)

		console.log('  🔍 Извлечение данных...')

		const matchesData = await page.evaluate(() => {
			const matches = []
			let currentRound = ''

			const allElements = document.querySelectorAll(
				'.event__round, .event__match, .event__match--last, [class*="event__match"], [class*="event__round"]',
			)

			for (const element of allElements) {
				const classList = element.className

				if (classList.includes('event__round')) {
					const roundMatch = element.innerText.match(/\d+|[А-Яа-я]+/)
					if (roundMatch) {
						currentRound = roundMatch[0]
					}
				} else if (
					classList.includes('event__match') ||
					classList.includes('event__match--last')
				) {
					try {
						const timeElement = element.querySelector('.event__time')
						let matchDate = timeElement ? timeElement.innerText.trim() : ''

						if (matchDate.includes('\n')) {
							matchDate = matchDate.split('\n')[0].trim()
						}
						if (matchDate.includes('После')) {
							matchDate = matchDate.split(' ')[0]
						}

						let team1 = '',
							team2 = ''
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

						let score1 = 0,
							score2 = 0
						const scoreElements = element.querySelectorAll(
							'[data-testid*="tableScore"]',
						)

						if (scoreElements.length >= 2) {
							for (const scoreEl of scoreElements) {
								const isPrimary =
									scoreEl.getAttribute('data-type') === 'primary'
								const side = scoreEl.getAttribute('data-side')

								if (isPrimary && side === 'home') {
									score1 = parseInt(scoreEl.innerText) || 0
								} else if (isPrimary && side === 'away') {
									score2 = parseInt(scoreEl.innerText) || 0
								}
							}
						}

						if (score1 === 0 && score2 === 0) {
							const homeScore = element.querySelector('.event__score--home')
							const awayScore = element.querySelector('.event__score--away')
							if (homeScore && awayScore) {
								score1 = parseInt(homeScore.innerText) || 0
								score2 = parseInt(awayScore.innerText) || 0
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

						if (team1 && team2 && currentRound) {
							matches.push({
								round: currentRound,
								matchDate: matchDate,
								team1: team1,
								team2: team2,
								score1: score1,
								score2: score2,
								score: `${score1}:${score2}`,
								url: matchUrl,
							})
						}
					} catch (err) {
						// Игнорируем ошибки парсинга отдельных матчей
					}
				}
			}
			return matches
		})

		console.log(`  Найдено матчей: ${matchesData.length}`)

		const uniqueMatches = []
		const seenKeys = new Set()
		for (const match of matchesData) {
			const key = `${match.round}-${match.team1}-${match.team2}-${match.matchDate}`
			if (!seenKeys.has(key)) {
				seenKeys.add(key)
				uniqueMatches.push(match)
			}
		}

		console.log(`  Уникальных матчей: ${uniqueMatches.length}`)

		if (uniqueMatches.length === 0) {
			console.log('  ⚠️ Нет матчей для парсинга!')
			return { sortedMatches: [] }
		}

		console.log(
			'\n  ⏱️  Парсинг результатов по таймам и составов (параллельно)...',
		)
		const parsedResults = await parseMatchesParallel(uniqueMatches, context)

		for (const { match, halfDetails } of parsedResults) {
			match.firstHalfWins = halfDetails.firstHalfWins
			match.firstHalfDraws = halfDetails.firstHalfDraws
			match.firstHalfLosses = halfDetails.firstHalfLosses
			match.secondHalfWins = halfDetails.secondHalfWins
			match.secondHalfDraws = halfDetails.secondHalfDraws
			match.secondHalfLosses = halfDetails.secondHalfLosses
			match.firstHalfWinsAway = halfDetails.firstHalfWinsAway
			match.firstHalfDrawsAway = halfDetails.firstHalfDrawsAway
			match.firstHalfLossesAway = halfDetails.firstHalfLossesAway
			match.secondHalfWinsAway = halfDetails.secondHalfWinsAway
			match.secondHalfDrawsAway = halfDetails.secondHalfDrawsAway
			match.secondHalfLossesAway = halfDetails.secondHalfLossesAway
			match.firstHalfGoalsHome = halfDetails.firstHalfGoalsHome
			match.firstHalfGoalsAway = halfDetails.firstHalfGoalsAway
			match.secondHalfGoalsHome = halfDetails.secondHalfGoalsHome
			match.secondHalfGoalsAway = halfDetails.secondHalfGoalsAway
			match.homeGoals = halfDetails.homeGoals || []
			match.awayGoals = halfDetails.awayGoals || []
		}

		const sortedMatches = [...uniqueMatches].sort((a, b) => {
			const dateA = parseMatchDate(a.matchDate)
			const dateB = parseMatchDate(b.matchDate)
			return dateA - dateB
		})

		console.log(`  📅 Матчи отсортированы по дате`)

		const teamCumulativeStats = new Map()

		for (const match of sortedMatches) {
			const team1StatsBefore = teamCumulativeStats.get(match.team1) || {
				games: 0,
				wins: 0,
				draws: 0,
				losses: 0,
				firstHalfWins: 0,
				firstHalfDraws: 0,
				firstHalfLosses: 0,
				secondHalfWins: 0,
				secondHalfDraws: 0,
				secondHalfLosses: 0,
			}

			const team2StatsBefore = teamCumulativeStats.get(match.team2) || {
				games: 0,
				wins: 0,
				draws: 0,
				losses: 0,
				firstHalfWins: 0,
				firstHalfDraws: 0,
				firstHalfLosses: 0,
				secondHalfWins: 0,
				secondHalfDraws: 0,
				secondHalfLosses: 0,
			}

			match.statsBefore = {
				team1: { ...team1StatsBefore },
				team2: { ...team2StatsBefore },
			}

			const firstHalfHomeGoals = match.firstHalfGoalsHome
			const firstHalfAwayGoals = match.firstHalfGoalsAway
			const secondHalfHomeGoals = match.secondHalfGoalsHome
			const secondHalfAwayGoals = match.secondHalfGoalsAway

			let firstHalfHomeWin = 0
			let firstHalfHomeDraw = 0
			let firstHalfHomeLoss = 0

			if (firstHalfHomeGoals > firstHalfAwayGoals) {
				firstHalfHomeWin = 1
			} else if (firstHalfHomeGoals === firstHalfAwayGoals) {
				firstHalfHomeDraw = 1
			} else {
				firstHalfHomeLoss = 1
			}

			let firstHalfAwayWin = 0
			let firstHalfAwayDraw = 0
			let firstHalfAwayLoss = 0

			if (firstHalfAwayGoals > firstHalfHomeGoals) {
				firstHalfAwayWin = 1
			} else if (firstHalfAwayGoals === firstHalfHomeGoals) {
				firstHalfAwayDraw = 1
			} else {
				firstHalfAwayLoss = 1
			}

			let secondHalfHomeWin = 0
			let secondHalfHomeDraw = 0
			let secondHalfHomeLoss = 0

			if (secondHalfHomeGoals > secondHalfAwayGoals) {
				secondHalfHomeWin = 1
			} else if (secondHalfHomeGoals === secondHalfAwayGoals) {
				secondHalfHomeDraw = 1
			} else {
				secondHalfHomeLoss = 1
			}

			let secondHalfAwayWin = 0
			let secondHalfAwayDraw = 0
			let secondHalfAwayLoss = 0

			if (secondHalfAwayGoals > secondHalfHomeGoals) {
				secondHalfAwayWin = 1
			} else if (secondHalfAwayGoals === secondHalfHomeGoals) {
				secondHalfAwayDraw = 1
			} else {
				secondHalfAwayLoss = 1
			}

			const team1StatsAfter = { ...team1StatsBefore }
			team1StatsAfter.games++
			team1StatsAfter.wins += match.score1 > match.score2 ? 1 : 0
			team1StatsAfter.draws += match.score1 === match.score2 ? 1 : 0
			team1StatsAfter.losses += match.score1 < match.score2 ? 1 : 0

			team1StatsAfter.firstHalfWins += firstHalfHomeWin
			team1StatsAfter.firstHalfDraws += firstHalfHomeDraw
			team1StatsAfter.firstHalfLosses += firstHalfHomeLoss

			team1StatsAfter.secondHalfWins += secondHalfHomeWin
			team1StatsAfter.secondHalfDraws += secondHalfHomeDraw
			team1StatsAfter.secondHalfLosses += secondHalfHomeLoss

			teamCumulativeStats.set(match.team1, team1StatsAfter)

			const team2StatsAfter = { ...team2StatsBefore }
			team2StatsAfter.games++
			team2StatsAfter.wins += match.score2 > match.score1 ? 1 : 0
			team2StatsAfter.draws += match.score1 === match.score2 ? 1 : 0
			team2StatsAfter.losses += match.score2 < match.score1 ? 1 : 0

			team2StatsAfter.firstHalfWins += firstHalfAwayWin
			team2StatsAfter.firstHalfDraws += firstHalfAwayDraw
			team2StatsAfter.firstHalfLosses += firstHalfAwayLoss

			team2StatsAfter.secondHalfWins += secondHalfAwayWin
			team2StatsAfter.secondHalfDraws += secondHalfAwayDraw
			team2StatsAfter.secondHalfLosses += secondHalfAwayLoss

			teamCumulativeStats.set(match.team2, team2StatsAfter)
		}

		return { sortedMatches }
	} finally {
		await browser.close()
	}
}

function createExcelReport(sortedMatches, seasonName) {
	console.log(`\n📊 Создание Excel отчета для ${seasonName}...`)

	const workbook = new ExcelJS.Workbook()
	const worksheet = workbook.addWorksheet('Все_матчи')

	worksheet.getColumn(1).width = 25
	worksheet.getColumn(2).width = 35
	worksheet.getColumn(3).width = 35
	worksheet.getColumn(4).width = 35
	worksheet.getColumn(5).width = 15
	worksheet.getColumn(6).width = 35
	worksheet.getColumn(7).width = 35

	const allBorderStyle = {
		top: { style: 'thin' },
		left: { style: 'thin' },
		bottom: { style: 'thin' },
		right: { style: 'thin' },
	}

	let currentRow = 1

	for (let i = 0; i < sortedMatches.length; i++) {
		const match = sortedMatches[i]
		const team1Stats = match.statsBefore.team1
		const team2Stats = match.statsBefore.team2

		const blockStartRow = currentRow

		const row1 = worksheet.getRow(currentRow)
		row1.getCell(1).value = 'дата матча'
		row1.getCell(1).font = { bold: true }
		row1.getCell(1).fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'A8E4A0' },
		}
		row1.getCell(2).value = match.matchDate || 'Н/Д'
		worksheet.mergeCells(currentRow, 2, currentRow, 3)
		currentRow++

		const row2 = worksheet.getRow(currentRow)
		row2.getCell(1).value = 'ссылка на матч'
		row2.getCell(1).font = { bold: true }
		row2.getCell(2).value = match.url || 'Н/Д'
		worksheet.mergeCells(currentRow, 2, currentRow, 3)
		currentRow++

		const row3 = worksheet.getRow(currentRow)
		row3.getCell(1).value = 'Счет'
		row3.getCell(1).font = { bold: true }
		row3.getCell(2).value = match.score1
		row3.getCell(3).value = match.score2
		currentRow++

		// Добавляем заголовки для составов
		const lineupHeaderRow = worksheet.getRow(currentRow)
		lineupHeaderRow.getCell(1).value = ''
		lineupHeaderRow.getCell(2).value = ''
		lineupHeaderRow.getCell(3).value = ''
		lineupHeaderRow.getCell(6).value = match.homeTeamLineup || match.team1
		lineupHeaderRow.getCell(6).font = { bold: true, size: 12 }
		lineupHeaderRow.getCell(7).value = match.awayTeamLineup || match.team2
		lineupHeaderRow.getCell(7).font = { bold: true, size: 12 }
		worksheet.mergeCells(currentRow, 1, currentRow, 5)
		currentRow++

		// Добавляем игроков стартового состава
		const homePlayers = match.homePlayers || []
		const awayPlayers = match.awayPlayers || []

		// Заполняем до 11 игроков
		const maxPlayers = Math.max(homePlayers.length, awayPlayers.length, 11)

		for (let j = 0; j < maxPlayers; j++) {
			const playerRow = worksheet.getRow(currentRow)
			const homePlayer = j < homePlayers.length ? homePlayers[j] : ''
			const awayPlayer = j < awayPlayers.length ? awayPlayers[j] : ''

			playerRow.getCell(6).value = homePlayer
			playerRow.getCell(7).value = awayPlayer
			currentRow++
		}

		const homeGoals = match.homeGoals || []
		const homeScorerHeaderRow = worksheet.getRow(currentRow)
		homeScorerHeaderRow.getCell(1).value = ''
		homeScorerHeaderRow.getCell(2).value = ''
		homeScorerHeaderRow.getCell(3).value = ''
		homeScorerHeaderRow.getCell(4).value = `Голы ${match.team1}`
		homeScorerHeaderRow.getCell(4).font = { bold: true }
		worksheet.mergeCells(currentRow, 4, currentRow, 5)
		currentRow++

		if (homeGoals.length > 0) {
			for (const goal of homeGoals) {
				const scorerRow = worksheet.getRow(currentRow)
				scorerRow.getCell(4).value = goal.name
				scorerRow.getCell(5).value = 1
				currentRow++
			}
		} else {
			const emptyRow = worksheet.getRow(currentRow)
			emptyRow.getCell(4).value = 'Нет голов'
			emptyRow.getCell(5).value = ''
			currentRow++
		}

		const awayGoals = match.awayGoals || []
		const awayScorerHeaderRow = worksheet.getRow(currentRow)
		awayScorerHeaderRow.getCell(1).value = ''
		awayScorerHeaderRow.getCell(2).value = ''
		awayScorerHeaderRow.getCell(3).value = ''
		awayScorerHeaderRow.getCell(4).value = `Голы ${match.team2}`
		awayScorerHeaderRow.getCell(4).font = { bold: true }
		worksheet.mergeCells(currentRow, 4, currentRow, 5)
		currentRow++

		if (awayGoals.length > 0) {
			for (const goal of awayGoals) {
				const scorerRow = worksheet.getRow(currentRow)
				scorerRow.getCell(4).value = goal.name
				scorerRow.getCell(5).value = 1
				currentRow++
			}
		} else {
			const emptyRow = worksheet.getRow(currentRow)
			emptyRow.getCell(4).value = 'Нет голов'
			emptyRow.getCell(5).value = ''
			currentRow++
		}

		const row4 = worksheet.getRow(currentRow)
		row4.getCell(1).value = 'первый тайм'
		row4.getCell(1).font = { bold: true }
		row4.getCell(2).value = match.firstHalfGoalsHome
		row4.getCell(3).value = match.firstHalfGoalsAway
		currentRow++

		const row5 = worksheet.getRow(currentRow)
		row5.getCell(1).value = 'второй тайм'
		row5.getCell(1).font = { bold: true }
		row5.getCell(2).value = match.secondHalfGoalsHome
		row5.getCell(3).value = match.secondHalfGoalsAway
		currentRow++

		const row6 = worksheet.getRow(currentRow)
		row6.getCell(1).value = 'название команд'
		row6.getCell(1).font = { bold: true }
		row6.getCell(2).value = match.team1
		row6.getCell(3).value = match.team2
		currentRow++

		const row7 = worksheet.getRow(currentRow)
		row7.getCell(1).value = 'Количество игр'
		row7.getCell(1).font = { bold: true }
		row7.getCell(2).value = team1Stats.games
		row7.getCell(3).value = team2Stats.games
		currentRow++

		const row8 = worksheet.getRow(currentRow)
		row8.getCell(1).value = 'Победы'
		row8.getCell(1).font = { bold: true }
		row8.getCell(2).value = team1Stats.wins
		row8.getCell(3).value = team2Stats.wins
		currentRow++

		const row9 = worksheet.getRow(currentRow)
		row9.getCell(1).value = 'Ничьи'
		row9.getCell(1).font = { bold: true }
		row9.getCell(2).value = team1Stats.draws
		row9.getCell(3).value = team2Stats.draws
		currentRow++

		const row10 = worksheet.getRow(currentRow)
		row10.getCell(1).value = 'Поражения'
		row10.getCell(1).font = { bold: true }
		row10.getCell(2).value = team1Stats.losses
		row10.getCell(3).value = team2Stats.losses
		currentRow++

		const row11 = worksheet.getRow(currentRow)
		row11.getCell(1).value = 'Первый тайм'
		row11.getCell(1).font = { bold: true, size: 12 }
		row11.getCell(1).fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFFF00' },
		}
		row11.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
		worksheet.mergeCells(currentRow, 1, currentRow, 3)
		currentRow++

		const row12 = worksheet.getRow(currentRow)
		row12.getCell(1).value = 'Победы'
		row12.getCell(1).font = { bold: true }
		row12.getCell(2).value = team1Stats.firstHalfWins
		row12.getCell(3).value = team2Stats.firstHalfWins
		currentRow++

		const row13 = worksheet.getRow(currentRow)
		row13.getCell(1).value = 'Ничьи'
		row13.getCell(1).font = { bold: true }
		row13.getCell(2).value = team1Stats.firstHalfDraws
		row13.getCell(3).value = team2Stats.firstHalfDraws
		currentRow++

		const row14 = worksheet.getRow(currentRow)
		row14.getCell(1).value = 'Поражения'
		row14.getCell(1).font = { bold: true }
		row14.getCell(2).value = team1Stats.firstHalfLosses
		row14.getCell(3).value = team2Stats.firstHalfLosses
		currentRow++

		const row15 = worksheet.getRow(currentRow)
		row15.getCell(1).value = 'Второй тайм'
		row15.getCell(1).font = { bold: true, size: 12 }
		row15.getCell(1).fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: 'FFFF00' },
		}
		row15.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
		worksheet.mergeCells(currentRow, 1, currentRow, 3)
		currentRow++

		const row16 = worksheet.getRow(currentRow)
		row16.getCell(1).value = 'Победы'
		row16.getCell(1).font = { bold: true }
		row16.getCell(2).value = team1Stats.secondHalfWins
		row16.getCell(3).value = team2Stats.secondHalfWins
		currentRow++

		const row17 = worksheet.getRow(currentRow)
		row17.getCell(1).value = 'Ничьи'
		row17.getCell(1).font = { bold: true }
		row17.getCell(2).value = team1Stats.secondHalfDraws
		row17.getCell(3).value = team2Stats.secondHalfDraws
		currentRow++

		const row18 = worksheet.getRow(currentRow)
		row18.getCell(1).value = 'Поражения'
		row18.getCell(1).font = { bold: true }
		row18.getCell(2).value = team1Stats.secondHalfLosses
		row18.getCell(3).value = team2Stats.secondHalfLosses
		currentRow++

		const blockEndRow = currentRow - 1

		for (let row = blockStartRow; row <= blockEndRow; row++) {
			for (let col = 1; col <= 7; col++) {
				const cell = worksheet.getRow(row).getCell(col)
				cell.border = allBorderStyle
			}
		}

		currentRow++
		currentRow++
	}

	const filename = path.join(CONFIG.outputDir, `${seasonName}_report_full.xlsx`)
	workbook.xlsx.writeFile(filename)
	console.log(`  ✅ Excel отчет сохранен: ${filename}`)

	return filename
}

async function parseAllSeasons() {
	console.log(
		'⚽ ПАРСЕР РЕЗУЛЬТАТОВ ФУТБОЛЬНЫХ МАТЧЕЙ (ТЕСТОВЫЙ РЕЖИМ - ТОЛЬКО СЕЗОН 2014-2015)\n',
	)
	console.log(`📁 Папка: ${CONFIG.outputDir}`)
	console.log(`⚡ Параллельных потоков: ${CONFIG.concurrentMatches}`)
	console.log(`📅 Количество сезонов для парсинга: ${CONFIG.seasons.length}\n`)

	const startTime = Date.now()
	let totalMatches = 0

	for (let i = 0; i < CONFIG.seasons.length; i++) {
		const season = CONFIG.seasons[i]
		console.log(`\n${'='.repeat(60)}`)
		console.log(
			`📋 Сезон ${i + 1}/${CONFIG.seasons.length}: ${season.seasonName}`,
		)
		console.log(`${'='.repeat(60)}`)

		try {
			const seasonStartTime = Date.now()
			const { sortedMatches } = await parseSeasonResults(season)

			if (sortedMatches && sortedMatches.length > 0) {
				createExcelReport(sortedMatches, season.seasonName)

				const seasonTime = ((Date.now() - seasonStartTime) / 1000).toFixed(2)
				console.log(
					`\n  ✅ Сезон ${season.seasonName} завершен за ${seasonTime} секунд`,
				)
				console.log(`  📊 Обработано матчей: ${sortedMatches.length}`)

				totalMatches += sortedMatches.length

				const totalGoals = sortedMatches.reduce(
					(sum, m) => sum + m.score1 + m.score2,
					0,
				)
				const avgGoals = (totalGoals / sortedMatches.length).toFixed(2)
				console.log(`  ⚽ Всего голов: ${totalGoals}`)
				console.log(`  📊 Средняя результативность: ${avgGoals} гола за матч`)
			} else {
				console.log(
					`  ⚠️ Не найдено ни одного матча для сезона ${season.seasonName}`,
				)
			}
		} catch (error) {
			console.error(
				`  ❌ Ошибка при парсинге сезона ${season.seasonName}:`,
				error.message,
			)
		}
	}

	const totalTime = ((Date.now() - startTime) / 1000).toFixed(2)
	console.log(`\n${'='.repeat(60)}`)
	console.log('📊 ОБЩАЯ СТАТИСТИКА ПО ВСЕМ СЕЗОНАМ:')
	console.log(`   ✅ Обработано сезонов: ${CONFIG.seasons.length}`)
	console.log(`   ✅ Всего матчей: ${totalMatches}`)
	console.log(
		`   ⏱️  Общее время: ${totalTime} секунд (${(totalTime / 60).toFixed(2)} минут)`,
	)
	console.log(`${'='.repeat(60)}`)
}

// Запуск парсинга всех сезонов
parseAllSeasons().catch(console.error)
