# football-parser

Парсер футбольных матчей с `livescore.in` + локальный веб-интерфейс.

## Запуск

```powershell
npm install
npm run web
```

Откройте `http://localhost:3000`.

## База данных (передача другому пользователю)

См. [docs/DATABASE.md](docs/DATABASE.md) — как собрать `data/football.db` и подключить на другом ПК.

## Загрузка лиг

- Одна лига:

```powershell
npm run preload-league -- eng-premier-2024
```

- Все лиги с `"enabled": true` в `data/leagues.config.json`:

```powershell
npm run preload
```

