# Мир Сливки: Inventory v1.0

Статус: implemented on current JSON storage.

Версия: 1.0.0.

## Назначение

Inventory v1.0 централизует игровые активы и их жизненный цикл. `OwnershipService` отдельно управляет владельцем, custody и permissions. Деньги и счета остаются исключительно в `EconomyService`.

Shop является официальным системным магазином. Marketplace, пользовательские listings, P2P-продажи и аукционы в эту версию не входят.

## Реализованная архитектура

- `InventoryService` хранит и изменяет assets, quantity, condition, location и lifecycle.
- `OwnershipService` регистрирует owners, назначает legal owner, custody и permissions.
- `CatalogService` определяет Product, AssetType, inventory mode и capabilities.
- `EconomyService` остаётся единственным источником истины для cash, bank, family capital и ledger.
- Transaction Event Collector сохраняет Inventory/Ownership facts в центральный Outbox; единый `EventBus` доставляет их после commit без прямых связей с Profile, Achievements и Forbes.
- JSON repositories реализуют ports; PostgreSQL repositories остаются отдельным инфраструктурным этапом.

## AssetType

Зарегистрированы:

- `transport`;
- `real_estate`;
- `business`;
- `license`;
- `item`;
- `pet`;
- `collectible`;
- `service`;
- `currency`;
- `quest`;
- `ticket`;
- `food`;
- `medicine`;
- `clothing`;
- `decoration`;
- `future`.

Product типа `currency` доступен Catalog/Economy, но `InventoryService.grant()` отклоняет его с `INVENTORY_CURRENCY_FORBIDDEN`.

## Владение и доступ

Поддерживаются owners `player`, `family`, `business`, `group`, `clan`, `system` и расширяемые значения.

Ownership v1.0 поддерживает:

- регистрацию владельца;
- assignment и transfer;
- legal owner и custody;
- owner/entry permissions;
- allow/deny с приоритетом deny;
- expiration и revoke entry/owner permissions;
- конфискацию, recovery и archive;
- owner index и append-only event history.

InventoryEntry не содержит authoritative owner. `ownership.records[instanceId]` является источником истины.

## Операции Inventory

Реализованы:

- grant, remove, clear и consume;
- transfer и gift;
- reserve, release и asset exchange primitive;
- equip/unequip и move;
- lease и return, включая частичный stack;
- destroy и restore;
- confiscate и recover;
- split/merge stack с lineage;
- repair, maintenance и upgrade;
- expiration;
- availability, valuation, pagination и history.

Каждая mutation использует idempotency key, operation record, correlation ID и центральные versioned History/Outbox. Legacy Inventory/Ownership history и outbox переносятся в runtime state без потери событий. Существующие `inventory.granted`/`inventory.removed` сохранены для UnlockService.

Reservation, lease и permission expiry принимают только корректные даты. Stack объединяются только при совпадении Product, location, purchase price, condition, durability, state и metadata, поэтому выдача не теряет индивидуальные свойства партии.

## Persistent state

В `GameState` добавлены `inventory` и `ownership`. Старые player/family arrays импортируются идемпотентно при чтении JSON и остаются compatibility projections. Балансы не мигрируют и не копируются в Inventory.

## Интеграции

- Shop: официальный purchase/sale через Economy + Inventory в одной JSON transaction.
- Admin: grant/reset/confiscate/recover только через Inventory/Ownership.
- Travel: требуемые билеты consume через Inventory.
- Family gifts: выдача через Inventory с Ownership authorization.
- Transport: repair/maintenance state меняется через InventoryService.
- Unlocks: grant/revoke и ownership transfer обрабатываются событиями.
- Profile/Forbes/Requirements: читают assets через InventoryService.

## Telegram

Сохранены все существующие команды. Добавлены:

- `/asset <instanceId>`;
- `/giveasset <instanceId> <telegramId>` с actor-bound quote/confirm/cancel;
- `/inventorylog`;
- admin `/confiscate`;
- admin `/recoveritem`.

Callback содержит только короткий session ID, проверяет actor, TTL и идемпотентность и укладывается в лимит Telegram 64 bytes.

## Изменённые файлы

Ключевые новые модули:

- `src/rpg/domain/inventory.ts`;
- `src/rpg/domain/ownership.ts`;
- `src/rpg/application/ownership-service.ts`;
- `src/rpg/application/ports/ownership-repository.ts`;
- `src/rpg/infrastructure/repositories/game-state-ownership-repository.ts`;
- `src/rpg/tests/inventory-v1.test.ts`.

Расширены InventoryService, ShopService, GameServices, AdminService, Catalog, JSON storage, Telegram composer и архитектурная документация.

## Проверка версии

`npm run test:rpg` выполняет функциональные и архитектурные тесты Shop, Inventory и Architecture Stabilization, включая currency isolation, ownership authority, permissions, idempotency, transfer identity, reservations, lease recovery, commit-only events, retention, legacy migration и Telegram gift sessions.

`npm run build` проверяет strict TypeScript.

## Следующая версия

Отдельный утверждаемый инфраструктурный этап:

- PostgreSQL Inventory/Ownership repositories;
- PostgreSQL UnitOfWork для существующих async repository ports;
- распределённые Outbox/Inbox workers через row-level locking;
- keyset queries и read projections для 10 миллионов assets;
- migration reconciliation report и нагрузочные тесты.

Marketplace проектируется отдельной системой после своего архитектурного документа. Он не будет расширением Shop.
