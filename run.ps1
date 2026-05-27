# Добавляет Node.js в PATH для этой сессии и запускает npm-команду
# Пример: .\run.ps1 web
#         .\run.ps1 refresh-goals eng-premier-2024
#         .\run.ps1 recompute-goals

$nodeDir = "C:\Program Files\nodejs"
if (Test-Path $nodeDir) {
	$env:PATH = "$nodeDir;$env:PATH"
} else {
	Write-Error "Node.js не найден в $nodeDir. Установите с https://nodejs.org/"
	exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if ($args.Count -eq 0) {
	Write-Host @"
Использование:
  .\run.ps1 web
  .\run.ps1 refresh-goals eng-premier-2024
  .\run.ps1 refresh-goals de-bundesliga-2024
  .\run.ps1 recompute-goals
"@
	exit 0
}

$cmd = $args[0]
$rest = @()
if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }

switch ($cmd) {
	'web' { npm run web; break }
	'refresh-goals' {
		if ($rest.Count -eq 0) { npm run refresh-goals }
		else { npm run refresh-goals -- @rest }
		break
	}
	'recompute-goals' { npm run recompute-goals; break }
	'preload-league' {
		if ($rest.Count -eq 0) { npm run preload-league }
		else { npm run preload-league -- @rest }
		break
	}
	default { npm run @args }
}
