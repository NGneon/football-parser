/**
 * Быстрое добавление архивных сезонов в leagues.config.json
 *
 * Примеры:
 *   node scripts/add-league.js --preset eng-premier --seasons 2023-2024,2022-2023
 *   node scripts/add-league.js --country "Англия" --league "Премьер-лига" \
 *     --slug england/premier-league --seasons 2024-2025 --enabled
 */
const { LEAGUE_PRESETS, addLeagueSeasons } = require('../lib/league-config')

function parseArgs(argv) {
	const opts = { seasons: [] }
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === '--enabled') {
			opts.enabled = true
			continue
		}
		if (arg.startsWith('--')) {
			const key = arg.slice(2)
			const val = argv[++i]
			if (key === 'seasons') {
				opts.seasons = val.split(',').map(s => s.trim()).filter(Boolean)
			} else {
				opts[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val
			}
		}
	}
	return opts
}

function main() {
	const opts = parseArgs(process.argv)

	if (opts.preset && LEAGUE_PRESETS[opts.preset]) {
		opts.country = opts.country || LEAGUE_PRESETS[opts.preset].country
		opts.league = opts.league || LEAGUE_PRESETS[opts.preset].league
		opts.slug = opts.slug || LEAGUE_PRESETS[opts.preset].slug
	}

	if (!opts.seasons?.length) {
		console.log(`
Добавление сезонов в data/leagues.config.json

Пресеты: ${Object.keys(LEAGUE_PRESETS).join(', ')}

Примеры:
  node scripts/add-league.js --preset eng-premier --seasons 2023-2024,2022-2023
  node scripts/add-league.js --country "Англия" --league "Премьер-лига" \\
    --slug england/premier-league --seasons 2024-2025 --enabled

После добавления:
  npm run preload-league -- <id>
`)
		process.exit(1)
	}

	const { added, skipped } = addLeagueSeasons(opts)

	console.log('\n✅ Конфиг обновлён\n')
	if (added.length) {
		console.log('Добавлено:')
		for (const e of added) {
			console.log(`  ${e.id}  ${e.season}  ${e.seasonUrl}`)
		}
	}
	if (skipped.length) {
		console.log('\nУже были (пропущено):', skipped.join(', '))
	}
	console.log(
		'\nЗагрузка матчей: npm run preload-league -- <id>\n' +
			'Или все enabled: npm run preload\n',
	)
}

main()
