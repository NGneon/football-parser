/**
 * Загружает все лиги с "enabled": true из leagues.config.json
 *
 *   npm run preload
 *   $env:SKIP_EXISTING=1; npm run preload   — пропустить уже сохранённые
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const CONFIG_PATH = path.join(__dirname, '../data/leagues.config.json')
const LEAGUES_DIR = path.join(__dirname, '../data/leagues')
const SKIP_EXISTING = process.env.SKIP_EXISTING === '1'

function runLeague(id) {
	return new Promise(resolve => {
		const child = spawn(
			process.execPath,
			[path.join(__dirname, 'preload-league.js'), id],
			{
				stdio: 'inherit',
				env: process.env,
			},
		)
		child.on('close', code => resolve(code === 0))
	})
}

function leagueFileExists(id) {
	return fs.existsSync(path.join(LEAGUES_DIR, `${id}.json`))
}

async function main() {
	const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
	const enabled = config.leagues.filter(l => l.enabled)

	if (!enabled.length) {
		console.log('Нет лиг с enabled: true в leagues.config.json')
		return
	}

	console.log(`Лиг к выгрузке: ${enabled.length}\n`)

	const ok = []
	const skipped = []
	const failed = []

	for (const league of enabled) {
		if (SKIP_EXISTING && leagueFileExists(league.id)) {
			console.log(`⏭ ${league.id} — уже есть файл, пропуск`)
			skipped.push(league.id)
			continue
		}

		console.log(`\n========== ${league.id} ==========\n`)
		const success = await runLeague(league.id)
		if (success) ok.push(league.id)
		else {
			failed.push(league.id)
			console.error(`\n❌ Ошибка: ${league.id} — продолжаем со следующей лигой\n`)
		}
	}

	console.log('\n——— Итог ———')
	console.log(`✅ Успешно: ${ok.length}`)
	if (skipped.length) console.log(`⏭ Пропущено (файл есть): ${skipped.length}`)
	if (failed.length) {
		console.log(`❌ Ошибки (${failed.length}):`)
		for (const id of failed) console.log(`   - ${id}`)
		process.exit(1)
	}
	console.log('\n✅ Все включённые лиги загружены')
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
