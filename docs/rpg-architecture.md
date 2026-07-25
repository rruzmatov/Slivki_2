# Telegram Family RPG Architecture

## Цель

RPG-слой живет отдельно от текущего бота и построен так, чтобы бизнес-логика не зависела от Telegram, JSON-файлов или будущей базы данных.

## Структура

- `src/rpg/domain` - типы, ошибки и чистые доменные контракты.
- `src/rpg/config` - балансировка, лимиты, формулы уровней.
- `src/rpg/data` - игровые каталоги: предметы, работа, путешествия, достижения.
- `src/rpg/application` - сервисный слой: игроки, экономика, работа, магазин, брак, путешествия, рейтинг.
- `src/rpg/infrastructure/storage` - JSON-хранилище, транзакционный boundary, атомарная запись.
- `src/rpg/bot` - Telegram UI на Telegraf: команды, клавиатуры, форматирование.
- `docs/rpg-architecture.md` - проектное описание и правила расширения.

## Модули

- Пользователь: профиль, баланс, XP, уровень, энергия, настройки, инвентарь, владение транспортом/домами/питомцами.
- Семья: партнеры, дата свадьбы, титул, любовь, уровень, капитал, общий прогресс, путешествия, достижения, совместная статистика.
- Любовь: растет через путешествия и совместные действия, хранится только у семьи.
- Экономика: все изменения денег проходят через `EconomyService` и ledger.
- Работа: `jobs` содержит карьерную лестницу, требования, кулдаун, выплату, XP и цену энергии.
- Магазин: `catalogItems` содержит категории домов, транспорта, питомцев, подарков, билетов и 100+ автомобилей.
- Инвентарь: хранит только `itemId`, количество и дату получения.
- Путешествия: требуют транспорт, билеты, уровень игрока или семьи.
- Достижения: выдаются сервисами по событию, не дублируются.
- Рейтинг: считается из любви, уровня семьи, капитала, достижений и путешествий.
- Админ-панель: `AdminService` выполняет выдачу/списание денег, XP, предметов, уровней, блокировки и сбросы через owner guard, audit log и транзакции.
- Логи/статистика: хранятся в `logs`, `ledger`, `stats`.

## JSON-структура

Корневой файл:

```json
{
  "players": {},
  "families": {},
  "marriageProposals": {},
  "ledger": [],
  "logs": [],
  "stats": {
    "commandsHandled": 0,
    "purchases": 0,
    "marriages": 0,
    "jobsCompleted": 0,
    "travels": 0,
    "dailyRewards": 0,
    "adminActions": 0
  }
}
```

Игрок хранится по Telegram ID. Семья, proposal, ledger и предметы используют собственные ID. Повторяющиеся данные не копируются: инвентарь содержит ссылки на `catalogItems`.

Семья хранит:

```json
{
  "id": "family_uuid",
  "partnerIds": [1, 2],
  "weddingDate": "2026-07-25T00:00:00.000Z",
  "title": "Новая семья",
  "love": 10,
  "level": 1,
  "xp": 0,
  "capital": 1000,
  "inventory": [],
  "achievements": [],
  "travelIds": [],
  "stats": {
    "jobsCompleted": 0,
    "purchases": 0,
    "travels": 0,
    "giftsSent": 0,
    "totalEarned": 0,
    "totalSpent": 0
  }
}
```

## Взаимодействие

1. Telegraf-команда получает Telegram identity.
2. `JsonGameDatabase.transaction()` читает и валидирует состояние.
3. Application-сервис выполняет операцию и изменяет состояние.
4. Состояние снова валидируется и атомарно записывается.
5. UI отправляет пользователю короткий результат.

## Безопасность

- Race Condition: операции сериализуются очередью внутри `JsonGameDatabase`.
- Double Click / Duplicate Rewards / Duplicate Marriage: сервисы проверяют текущий state внутри транзакции.
- Negative Balance: списание денег только через `EconomyService.debitPlayer`.
- Duplicate Purchases: покупки проходят через один transaction; idempotency keys можно добавить на уровне callback query.
- Flood/Spam: лимиты должны добавляться middleware перед composer.
- JSON Corruption: Zod-валидация, backup `.corrupt.<timestamp>`, создание нового пустого state.
- Data Loss: запись идет во временный файл и затем atomic rename.
- Блокировка игроков: `settings.blocked` проверяется сервисами.
- Админ-действия: доступны только `ownerIds`, каждая операция пишет audit log.

## Расширение

Новая система добавляется через:

1. Типы в `domain`.
2. Каталог/конфиг при необходимости.
3. Application-сервис без Telegram-зависимостей.
4. Репозиторий или JSON-state adapter.
5. Telegraf UI как тонкий слой.

При переходе на PostgreSQL/MongoDB меняется infrastructure слой. Сервисы сохраняют сигнатуры и тесты.

## Команды

- Профиль: `/profile`, `/family`, `/stats`, `/inventory`, `/backpack`, `/balance`, `/level`, `/skills`, `/achievements`.
- Брак: `/marry`, `/accept`, `/reject`, `/divorce`, `/love`, `/familyinfo`.
- Работа: `/jobs`, `/job`, `/work`, `/quitjob`, `/salary`.
- Магазин: `/shop`, `/buy`, `/sell`, `/catalog`, `/market`.
- Имущество: `/houses`, `/house`, `/garage`, `/cars`, `/bikes`, `/planes`, `/yachts`, `/pets`.
- Путешествия: `/travel`, `/trips`, `/ticket`, `/passport`, `/airport`.
- Подарки: `/gift`, `/flowers`, `/ring`.
- Рейтинг: `/topfamily`, `/families`.
- Админ: `/admin`, `/give`, `/take`, `/setlevel`, `/addxp`, `/addmoney`, `/resetuser`, `/ban`, `/unban`, `/broadcast`, `/logs`.
