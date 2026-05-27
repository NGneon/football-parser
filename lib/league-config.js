/**
 * Шаблоны URL и быстрое добавление сезонов лиг в leagues.config.json
 *
 * Пример:
 *   node scripts/add-league.js --country "Англия" --league "Премьер-лига" \
 *     --slug england/premier-league --seasons 2024-2025,2023-2024
 */

const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '../data/leagues.config.json')

/** Пресеты: slug на livescore.in без домена */
const LEAGUE_PRESETS = {
	'eng-premier': {
		country: 'Англия',
		league: 'Премьер-лига',
		slug: 'england/premier-league',
	},
	'es-laliga': {
		country: 'Испания',
		league: 'Ла Лига',
		slug: 'spain/laliga',
	},
	'de-bundesliga': {
		country: 'Германия',
		league: 'Бундеслига',
		slug: 'germany/bundesliga',
	},
	'ch-superleague': {
		country: 'Швейцария',
		league: 'Суперлига',
		slug: 'switzerland/super-league',
	},
	'it-serie-a': {
		country: 'Италия',
		league: 'Серия А',
		slug: 'italy/serie-a',
	},
	'fr-ligue-1': {
		country: 'Франция',
		league: 'Лига 1',
		slug: 'france/ligue-1',
	},
}

function seasonToLabel(seasonSlug) {
	// 2024-2025 -> 2024/2025
	const parts = seasonSlug.split('-')
	if (parts.length >= 2) {
		return `${parts[0]}/${parts[1]}`
	}
	return seasonSlug.replace(/-/g, '/')
}

function seasonToId(presetKey, seasonSlug) {
	const startYear = seasonSlug.split('-')[0]
	const short = presetKey.split('-').pop() || presetKey
	return `${presetKey.split('-')[0]}-${short}-${startYear}`
}

function buildSeasonUrl(slug, seasonSlug) {
	return `https://www.livescore.in/ru/football/${slug}-${seasonSlug}/results/`
}

function buildLeagueEntry({
	country,
	league,
	slug,
	seasonSlug,
	idPrefix,
	enabled = false,
}) {
	const season = seasonToLabel(seasonSlug)
	const startYear = seasonSlug.split('-')[0]
	let id
	if (idPrefix) {
		id = `${idPrefix}-${startYear}`
	} else {
		const parts = slug.split('/')
		const shortLeague = parts[1].replace(/-/g, '')
		const countryShort = parts[0].slice(0, 3)
		id = `${countryShort}-${shortLeague}-${startYear}`
	}
	const leagueLabel = `${country}: ${league}`

	return {
		id,
		country,
		league,
		season,
		leagueLabel,
		seasonUrl: buildSeasonUrl(slug, seasonSlug),
		enabled,
	}
}

function loadConfig() {
	if (!fs.existsSync(CONFIG_PATH)) {
		return { leagues: [] }
	}
	return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
}

function saveConfig(config) {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n', 'utf8')
}

/**
 * @param {object} opts
 * @param {string} [opts.preset] — ключ из LEAGUE_PRESETS
 * @param {string} [opts.country]
 * @param {string} [opts.league]
 * @param {string} [opts.slug] — england/premier-league
 * @param {string[]} opts.seasons — ['2024-2025', '2023-2024']
 * @param {boolean} [opts.enabled]
 */
function addLeagueSeasons(opts) {
	const preset = opts.preset ? LEAGUE_PRESETS[opts.preset] : null
	const country = opts.country || preset?.country
	const league = opts.league || preset?.league
	const slug = opts.slug || preset?.slug

	if (!country || !league || !slug) {
		throw new Error(
			'Укажите preset или country, league и slug (например england/premier-league)',
		)
	}

	const seasons = opts.seasons || []
	if (!seasons.length) {
		throw new Error('Укажите хотя бы один сезон, например 2024-2025')
	}

	const config = loadConfig()
	const added = []
	const skipped = []

	const idPrefix = opts.preset || opts.idPrefix

	for (const seasonSlug of seasons) {
		const entry = buildLeagueEntry({
			country,
			league,
			slug,
			seasonSlug,
			idPrefix,
			enabled: !!opts.enabled,
		})

		const exists = config.leagues.some(l => l.id === entry.id)
		if (exists) {
			skipped.push(entry.id)
			continue
		}
		config.leagues.push(entry)
		added.push(entry)
	}

	config.leagues.sort((a, b) => {
		if (a.country !== b.country) return a.country.localeCompare(b.country)
		if (a.league !== b.league) return a.league.localeCompare(b.league)
		return String(b.season).localeCompare(String(a.season))
	})

	saveConfig(config)
	return { added, skipped, config }
}

module.exports = {
	CONFIG_PATH,
	LEAGUE_PRESETS,
	seasonToLabel,
	buildSeasonUrl,
	buildLeagueEntry,
	loadConfig,
	saveConfig,
	addLeagueSeasons,
}
