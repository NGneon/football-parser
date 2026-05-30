# База данных SQLite

Один файл `data/football.db` содержит все лиги и матчи. Его можно передать другому человеку — у него будет тот же веб-интерфейс без повторного парсинга.

## 1. Создать базу (у вас, после выгрузки лиг)

```powershell
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH
npm install
npm run db:import
```

Файл появится: `data/football.db`

## 2. Передать базу

Скопируйте файл `data/football.db` (можно через облако, флешку, архив).

JSON в `data/leagues/` для работы через БД **не нужны**.

## 3. Подключить у другого пользователя

1. Клонируйте репозиторий: https://github.com/NGneon/football-parser
2. Положите `football.db` в папку `data/football.db`
3. Установите зависимости и запустите:

```powershell
npm install
$env:USE_DB = "1"
npm run web
```

Откройте http://localhost:3000

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `USE_DB=1` | Читать данные только из SQLite |
| `USE_DB=0` | Только JSON из `data/leagues/` |
| `DB_PATH` | Путь к файлу БД (по умолчанию `data/football.db`) |

Если `data/football.db` существует, сервер использует БД автоматически.

## Обновление базы после нового парсинга

```powershell
npm run preload
npm run db:import
```

## Синхронизация одного матча

На сайте у незавершённых матчей есть кнопка **«Синхронизировать»** — подтягивает счёт, составы и PPG с Livescore.
