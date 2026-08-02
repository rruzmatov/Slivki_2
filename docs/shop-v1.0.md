# Мир Сливки — Shop v1.0

Статус: implemented.

## Назначение

Shop v1.0 — универсальная торговая система RPG. Магазин не содержит логики велосипедов, автомобилей, недвижимости, бизнеса или других конкретных категорий. Он работает с моделью `AssetType -> Category -> Product -> ShopListing`.

## Архитектурные границы

- `CatalogService` предоставляет типы активов, категории, продукты, listings и совместимые `CatalogItem`.
- `ShopService` создаёт checkout, подтверждает покупку или продажу и хранит неизменяемый заказ.
- `InventoryService` — единственная application-точка выдачи и изъятия игровых активов.
- `OwnershipService` — единственная точка определения владельца, custody и прав доступа.
- `EconomyService` — единственная application-точка изменения счетов магазина.
- `RequirementEvaluator` вычисляет деревья `AND`, `OR`, `NOT` и расширяемые predicates.
- `UnlockService` проецирует unlocks из событий inventory.
- `EventBus` исключает прямую зависимость Shop от достижений, семьи, профиля, транспорта и рейтинга.
- `GameServices` сохраняет старые методы и выступает compatibility facade.

Telegram и legacy-адаптеры зависят от application API. Application зависит от domain contracts и repository ports. JSON-адаптеры реализуют ports и не определяют игровые правила.

## Модель каталога

AssetType описывает природу актива, режим владения и capabilities. Начальная версия содержит:

- `transport`;
- `real_estate`;
- `business`;
- `license`;
- `item`;
- `pet`;
- `collectible`;
- `service`;
- `currency`.

AssetType `currency` используется Catalog/Economy, но не создаёт InventoryEntry. Все balances, accounts и ledger остаются источником истины EconomyService.

Category связывает Product с AssetType и определяет схему характеристик. Product содержит идентичность, характеристики, требования, unlocks и оценочную стоимость. Цена, остаток, период доступности и правила продажи находятся в ShopListing.

`CatalogItem` сохранён как совместимый DTO. Текущие каталожные записи преобразуются в универсальные Products при запуске и индексируются по ID.

## Владение

Каждая inventory-запись имеет `instanceId`, `itemId`/ProductId, количество, способ получения и источник операции.

- `stack` объединяет одинаковые предметы;
- `instance` создаёт отдельную запись на каждую единицу;
- `entitlement` запрещает повторное владение;
- `immediate` выполняет выдачу без постоянной inventory-записи.

Совместимые индексы `transportIds`, `homeIds`, `businessIds`, `petIds` поддерживаются `InventoryService` и не являются источником истины.

## События

Transaction Event Collector записывает versioned events в центральные History и Outbox в той же транзакции, что Economy, Inventory, Ownership и Shop. Единственный EventBus публикует их только после commit:

- `inventory.granted`;
- `inventory.removed`;
- `unlock.granted`;
- `unlock.revoked`;
- `shop.order.completed`.

Ошибка обработчика не отменяет уже committed игровую операцию: Outbox получает retry с backoff, а consumer Inbox предотвращает повторный side effect. После 20 неуспешных доставок запись становится `dead_letter` и сохраняется до retention.

## Unlocks

Product может открывать механики с произвольным `type` и `targetId`. Поддерживаются постоянные unlocks и unlocks, действующие пока объект принадлежит владельцу. Транспортный каталог v1.0 открывает профессии через тип `job`.

Все способы получения Product — Shop, Admin, Gift или Reward — проходят через InventoryService и поэтому одинаково создают unlocks.

## Requirements

Требование является рекурсивным выражением:

- `predicate`;
- `and`;
- `or`;
- `not`.

Ограничения безопасности: глубина до 32 уровней и до 256 узлов на вычисление. Встроены predicates уровня, баланса, уровня семьи, владения Product/Category/AssetType, unlock, достижения и страны. Дополнительный predicate регистрируется без изменения алгоритма композиции.

## Checkout и идемпотентность

Покупка и продажа состоят из quote и confirm. Checkout привязан к игроку, имеет срок действия, snapshot цены и версию listing. Confirm повторно проверяет доступность, требования, владельца, остаток и счёт.

Один idempotency key создаёт не более одного заказа и одной ledger-проводки. Повторный Telegram callback возвращает существующий результат.

## Persistent state

В `GameState` добавлены:

- `shop.checkoutSessions`;
- `shop.orders`;
- `shop.idempotencyKeys`;
- `shop.listingRuntime`;
- `unlocks.records`.

Zod-defaults автоматически добавляют новые корневые структуры старым JSON-файлам. Старые inventory-записи получают `instanceId` и `acquiredBy: migration`. Версионированная reconciliation-проекция один раз восстанавливает unlocks из уже существующего имущества владельца.

## Telegram API

Сохранены `/shop`, `/catalog`, `/market`, `/buy`, `/sell`, `/bike` и категорийные команды. `/market` является compatibility alias официального каталога, а не P2P Marketplace. Добавлены `/item` и `/orders`.

Новый checkout поддерживает оплату наличными или из банка, отмену, журнал заказов, категории AssetType и постраничный каталог. Старые `buy_confirm:<itemId>` обрабатываются совместимым фасадом.

Shop обслуживает только системные listings. Пользовательские listings, P2P-продажи и аукционы относятся к отдельной будущей системе Marketplace.

## Производительность

Каталог индексируется один раз. Product и Listing читаются за `O(1)`. Каталожные страницы ограничены 25 элементами. Покупка выполняется одной сериализованной JSON-транзакцией.

Текущее ограничение — полная сериализация GameState при записи. PostgreSQL-миграция является отдельной версией инфраструктуры и обязательна перед эксплуатацией на 100 000+ игроков. Domain, application API, команды и события при этом сохраняются.

## Проверка версии

Команда `npm run test:rpg` компилирует проект и проверяет:

- иерархию AssetType/Category/Product и AssetType currency;
- атомарную и идемпотентную покупку;
- уникальные inventory instances;
- отзыв while-owned unlock после продажи;
- административную выдачу через InventoryService;
- составные требования AND/OR/NOT;
- загрузку legacy JSON с Shop v1 defaults.

## Следующая версия

Следующий инфраструктурный этап: PostgreSQL repositories и PostgreSQL UnitOfWork поверх уже действующих async ports, Outbox и Inbox. Функциональное развитие магазина после этого может включать административное управление listings, промокоды и региональные цены. P2P и аукционы остаются отдельным Marketplace.
