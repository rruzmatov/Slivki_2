# Telegram Family RPG Architecture

## Цель

RPG-слой живет отдельно от текущего бота и построен так, чтобы бизнес-логика не зависела от Telegram, JSON-файлов или будущей базы данных.

## Структура

- `src/rpg/domain` - типы, ошибки, AssetType/Category/Product, Inventory, Ownership, ShopOrder, unlocks и чистые доменные контракты.
- `src/rpg/config` - балансировка, лимиты, формулы уровней.
- `src/rpg/data` - игровые каталоги: предметы, работа, путешествия, достижения.
- `src/rpg/application` - сервисный слой: игроки, экономика, центральный inventory, каталог, магазин, unlocks, события, требования, брак, путешествия и рейтинг.
- `src/rpg/bootstrap` - единственный Composition Root, создающий сервисы, EventBus, UnitOfWork, Scheduler и adapters.
- `src/rpg/infrastructure` - JSON adapters, UnitOfWork и атомарная запись; `GameState` не покидает этот слой.
- `src/rpg/bot` - Telegram UI на Telegraf: команды, клавиатуры, форматирование.
- `docs/rpg-architecture.md` - проектное описание и правила расширения.

## Модули

- Пользователь: профиль, баланс, XP, уровень, энергия и настройки; имущество запрашивается через Inventory/Ownership.
- Семья: партнеры, дата свадьбы, титул, любовь, уровень, капитал, общий прогресс, путешествия, достижения, совместная статистика.
- Любовь: растет через путешествия и совместные действия, хранится только у семьи.
- Экономика: все изменения денег проходят через `EconomyService` и ledger.
- Работа: `jobs` содержит карьерную лестницу, требования, кулдаун, выплату, XP и цену энергии.
- Магазин: Shop v1.0 использует только официальные `AssetType -> Category -> Product -> ShopListing`; Marketplace является отдельной будущей системой; `catalogItems` сохранён как совместимый DTO.
- Инвентарь: `InventoryService` выполняет команды над assets, quantity, condition, location, reservations и leases; `InventoryQueryService` обслуживает чтение, valuation, availability и history. Прежние query methods InventoryService делегируют ему для совместимости.
- Владение: `OwnershipService` является источником истины для legal owner, custody и permissions. Compatibility-массивы профиля и семьи не являются источником истины.
- Валюта: balances, банковские счета, семейный капитал и ledger принадлежат только `EconomyService`; AssetType currency не создаёт InventoryEntry.
- Unlocks: Product открывает профессии и другие механики через универсальные records без прямой зависимости модулей.
- Требования: `RequirementEvaluator` поддерживает predicate, AND, OR и NOT.
- События: transaction collector сохраняет versioned events в History/Outbox внутри commit; единый `EventBus` публикует их только после commit.
- Scheduler: персистентные задачи, lease/retry и idempotency заменяют игровые `setTimeout`.
- Schema Registry: attributes, metadata, event, scheduler и integration payloads валидируются по schema id и version.
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
  "shop": {
    "version": "1.0.0",
    "checkoutSessions": {},
    "orders": {},
    "idempotencyKeys": {},
    "listingRuntime": {}
  },
  "unlocks": { "records": {}, "reconciledOwners": {} },
  "inventory": {
    "version": "1.0.0",
    "entries": {},
    "reservations": {},
    "equipment": {},
    "leases": {},
    "operations": {},
    "history": [],
    "outbox": {},
    "actionSessions": {}
  },
  "ownership": {
    "version": "1.0.0",
    "owners": {},
    "records": {},
    "entryIdsByOwner": {},
    "permissions": {},
    "ownerAccess": {},
    "history": [],
    "outbox": {}
  },
  "runtime": {
    "version": "1.0.0",
    "history": [],
    "outbox": {},
    "inbox": {},
    "idempotency": {},
    "schedulerTasks": {}
  },
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
2. Application facade открывает `UnitOfWorkManager` и вызывает transaction-bound services; прямые мутации Inventory, Ownership и Shop repositories из orchestrators запрещены architecture test.
3. Application-сервис выполняет операцию; transaction collector накапливает domain events.
4. JSON adapter валидирует и атомарно записывает state вместе с History/Outbox.
5. После успешного commit единый EventBus доставляет события; Inbox обеспечивает идемпотентность consumers.
6. UI отправляет пользователю короткий результат.

## Безопасность

- Race Condition: операции сериализуются очередью внутри `JsonGameDatabase`.
- Double Click / Duplicate Rewards / Duplicate Marriage: сервисы проверяют текущий state внутри транзакции.
- Duplicate Purchase/Sale: checkout state и idempotency key предотвращают повторный заказ и ledger-проводку.
- Negative Balance: списание денег только через `EconomyService.debitPlayer`.
- Duplicate Purchases: покупки проходят через один transaction; idempotency keys можно добавить на уровне callback query.
- Flood/Spam: лимиты должны добавляться middleware перед composer.
- JSON Corruption: Zod-валидация, source остаётся неизменным, диагностическая копия создаётся как `.corrupt.<timestamp>`, запуск останавливается без потери state.
- Data Loss: запись идет во временный файл и затем atomic rename.
- Event Delivery: Outbox retry с exponential backoff, после 20 ошибок запись становится `dead_letter`.
- Timer Recovery: Scheduler возвращает в обработку `running` task после истечения lease.
- Блокировка игроков: `settings.blocked` проверяется сервисами.
- Админ-действия: доступны только `ownerIds`, каждая операция пишет audit log.

## Расширение

Новая система добавляется через:

1. Типы в `domain`.
2. Каталог/конфиг при необходимости.
3. Application-сервис без Telegram-зависимостей.
4. Async repository port; adapter регистрируется только в Composition Root.
5. Telegraf UI как тонкий слой.

При переходе на PostgreSQL меняются infrastructure adapters и реализация UnitOfWork. Application API, события, команды и тесты сохраняются.

Подробный отчёт текущего этапа: `docs/architecture-stabilization-v1.0.md`.

## Команды

- Профиль: `/profile`, `/family`, `/stats`, `/inventory`, `/backpack`, `/balance`, `/level`, `/skills`, `/achievements`.
- Брак: `/marry`, `/accept`, `/reject`, `/divorce`, `/love`, `/familyinfo`.
- Работа: `/jobs`, `/job`, `/work`, `/quitjob`, `/salary`.
- Магазин: `/shop`, `/buy`, `/sell`, `/catalog`, `/market`.
- Журнал магазина: `/item`, `/orders`.
- Имущество: `/houses`, `/house`, `/garage`, `/cars`, `/bikes`, `/planes`, `/yachts`, `/pets`.
- Путешествия: `/travel`, `/trips`, `/ticket`, `/passport`, `/airport`.
- Подарки: `/gift`, `/flowers`, `/ring`.
- Рейтинг: `/topfamily`, `/families`.
- Админ: `/admin`, `/give`, `/take`, `/setlevel`, `/addxp`, `/addmoney`, `/resetuser`, `/ban`, `/unban`, `/broadcast`, `/logs`.
