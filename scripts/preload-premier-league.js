/** @deprecated Используйте: npm run preload-premier или npm run preload-league -- eng-premier-2024 */
require('child_process').spawnSync(
	process.execPath,
	[require('path').join(__dirname, 'preload-league.js'), 'eng-premier-2024'],
	{ stdio: 'inherit', env: process.env },
)
