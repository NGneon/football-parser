/**
 * Импорт всех JSON из data/leagues/ в SQLite (data/football.db)
 *
 *   node scripts/db-import.js
 *   $env:DB_PATH="C:\path\football.db"; node scripts/db-import.js
 */
const { importAllJsonToDb, getDbPath } = require('../lib/db')

const result = importAllJsonToDb()
console.log(`\n✅ База: ${result.dbPath}`)
console.log(`   Лиг: ${result.leagues}, матчей: ${result.matches}`)
console.log(
	'\nПередайте файл .db другому пользователю и запустите:\n' +
		'  $env:USE_DB=1; npm run web\n',
)
