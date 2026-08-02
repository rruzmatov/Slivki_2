# Мир Сливки: Transport v1.0

Статус: Phase 0, Phase 1 и Phase 2 implemented.

Версии:

- Transport Schema Version: `1.0.0`;
- Transport API Version: `1.0`;
- Transport Event Registry Version: `1.0.0`;
- Transport Catalog Revision: `1`.

## Phase 0: Baseline Audit

До изменений выполнены build, RPG tests, architecture tests, проверка conflict markers, `git diff --check`, циклических зависимостей, async repository contracts и Telegram compatibility. Build и 53 исходных теста проходили. Единственная baseline-проблема: в `package.json` отсутствовал `lint`-скрипт.

Рабочее дерево изначально содержало значительный объём незакоммиченных изменений. Они считаются пользовательским baseline, не удалялись и не откатывались.

Baseline-риски:

- JSON adapter сериализует единый state и рассчитан на один процесс;
- legacy transport catalog содержит активные модели помимо первого велосипеда;
- legacy Jobs, Travel и transport compatibility facade содержат проверки категорий;
- у Transport отсутствовали собственные domain contracts, registry и repository boundary;
- metadata и payload старых событий используют универсальные record schemas;
- PostgreSQL migration требует отдельного утверждённого этапа.

## Phase 1: Foundation

Foundation не добавляет новую игровую механику и не меняет Telegram UX. Он фиксирует расширяемые контракты, на которых строятся следующие этапы.

### Версионирование

Schema, API, Event Registry и Catalog Revision разделены. Изменение одного номера не требует автоматического изменения остальных. DTO Foundation immutable и содержат явную API/schema version.

### Capability Registry

`VehicleCapabilityRegistry` является источником определений возможностей. Registry проверяет:

- формат и уникальность code;
- неизвестные dependencies и implied capabilities;
- циклы dependency graph;
- составные правила `all`, `any`, `not`;
- типы, диапазоны и обязательность параметров;
- полноту dependencies конкретной модели.

Начальный registry содержит `ride`, `drive`, `rail`, `fly`, `sail`, `cargo`, `tow`, `passengers`, `delivery`, `offroad`, `urban`, `domestic`, `international`, `business`, `military`. `delivery` требует `cargo` и одну из возможностей `ride` или `drive`. Domain не проверяет конкретную категорию транспорта.

### Energy Registry

`VehicleEnergyTypeRegistry` поддерживает `human`, `fuel`, `electric`, `hybrid`, `hydrogen`, `nuclear`. Foundation хранит контракт energy profile, но не реализует расход энергии. Giant Escape 3 использует `human` без runtime energy state.

### Ownership Permissions

Фиксированные массивы прав в `OwnershipService` заменены `OwnershipPermissionRegistry`. Сохранены прежние права и добавлены `inspect`, `maintain`, `sell`, `upgrade`. Все решения по legal owner, custody, explicit allow/deny и implied permissions выполняет только OwnershipService.

Transport contracts не хранят owner, tenant, lease или permissions. Family и Business разрешены как owner kinds транспортного AssetType; фактическое право доступа остаётся ответственностью Ownership.

### Catalog Foundation

Giant Escape 3 получает валидируемый `VehicleFoundationSpecification`:

- schema version и catalog revision;
- capabilities `ride`, `cargo`, `delivery`, `urban`, `domestic`;
- cargo capacity 8 kg;
- energy type `human`;
- media key, emoji и localization key без Telegram `file_id`.

Остальной transport catalog сохранён без удаления и продолжает работать через legacy contract. Новые категории смогут получать Foundation specification через Catalog без category branching в Transport.

### Schema Registry

Добавлены строгие versioned schemas для Transport foundation attributes, утверждённых Transport event payloads, scheduler payloads и Telegram callback integration payload. Неизвестные поля и некорректные версии/значения отклоняются до persistence или dispatch.

Marketplace и Achievements не импортируются. Для них зарегистрированы только versioned event contracts.

### Composition Root

Ownership Permission, Vehicle Capability и Energy Type registries, а также structured logger создаются в едином Composition Root. `CatalogService` получает registries через зависимости и валидирует транспортный catalog при запуске. `OwnershipService` получает permission registry через constructor injection.

### Error и Logging Contracts

`TransportErrorFactory` централизует Transport error code, localization key, details и retryability. `Logger` принимает структурированную operation record с operation/correlation/actor/vehicle IDs, duration и result без чувствительного payload.

### Архитектурная коррекция Phase 1

`TransportApiEnvelope`, `VehicleCapabilityDto`, `VehicleEnergyDto` и `VehicleFoundationDto` перенесены из Domain в `application/contracts/transport-foundation.ts`. Структура и публичные имена контрактов сохранены через RPG module export. Runtime, сериализация и поведение Foundation не изменились.

## Phase 1 Architecture Gates

Architecture tests проверяют:

- создание transport/permission registries только Composition Root;
- отсутствие hard category и hard capability decisions в Transport;
- отсутствие импортов Telegram, Marketplace, AchievementService и Economy Repository;
- отсутствие owner/permissions/Telegram file ID в Transport domain contracts;
- отсутствие Infrastructure и GameState в Domain/Application;
- async repository ports, отсутствие циклов и соблюдение существующих service boundaries.

Transport tests проверяют catalog model, составные dependencies, cycle detection, неизвестные capability, energy validation, permission delegation и строгие event/scheduler schemas.

## Совместимость

Существующие команды, callbacks, Shop, Inventory, Ownership, Economy, Scheduler, EventBus, Jobs и Travel не удалены. Поведение покупки, продажи, transfer, lease, unlocks, retention и legacy inventory migration сохранено существующими regression tests.

## Phase 2: Core Domain

Phase 2 реализует чистую доменную модель без Application Services, Repository, persistence, EventBus, Scheduler, UnitOfWork, Telegram и системных часов.

### Source of Truth

Inventory остаётся источником истины физического состояния экземпляра. `VehicleAggregate` не имеет Repository и не хранится самостоятельно: будущий Application Layer восстановит его из Inventory state, выполнит доменную операцию и передаст новый immutable `VehicleState` обратно Inventory. В `VehicleState` отсутствуют owner, tenant и permissions; эти данные остаются в Ownership.

### Vehicle Aggregate и State Machine

Поддержаны состояния `available`, `in_use`, `under_maintenance`, `under_repair`, `out_of_service`, `retired`. Разрешены утверждённые переходы и аварийный `in_use -> out_of_service`, когда structural health достигает нуля. Запрещённые переходы завершаются типизированной ошибкой до изменения state.

Aggregate проверяет expected version, единственную активную Usage, соответствие active process операционному состоянию, monotonic timestamps, состояние condition, schedule и отсутствие операций после retirement.

### Mileage и Usage

`Mileage` хранит целое число метров, предоставляет километры, monotonic update, защиту safe-integer overflow и immutable serialization snapshot.

`VehicleUsage` поддерживает `planned`, `active`, `completed`, `cancelled`. Проверяются purpose, хронология, положительная плановая и неотрицательная фактическая дистанция, обязательная причина отмены и запрет переходов из terminal state. Vehicle допускает только одну active Usage и увеличивает odometer только при completion.

### Structural Damage

`StructuralCondition` содержит maximum/current health и accumulated wear в snapshot, полученном от Inventory. `StructuralDamagePolicy` рассчитывает direct damage, distance wear, broken detection и compatibility projection `new/good/worn/broken` с legacy wear level. Конфигурация wear передаётся извне и не зависит от категории.

### Maintenance

Реализованы `MaintenanceTaskDefinition`, `ServiceInterval`, `MaintenancePolicy`, `MaintenanceSchedule`, `MaintenanceQuote` и `MaintenanceResult`. Интервалы могут одновременно учитывать distance, time и usage count. Поддержаны early service window, due, overdue, critical overdue и versioned pricing multiplier. Обслуживание до early window запрещено.

### Repair и Pricing

`RepairPolicy` требует непустую причину, damaged condition, неизменившийся condition snapshot и действующую quote. Repair не обращается к Economy и возвращает immutable result.

`RepairPricingPolicy`, `MaintenancePricingPolicy` и `ResaleValuationPolicy` являются заменяемыми strategy contracts. Rate-based реализации используют переданные base amount, rarity, age, asset type, category, economic balance, condition, mileage и overdue factors. Все расчёты защищены от overflow, а каждая breakdown и quote содержит policy version.

### Eligibility и Active Vehicle

`TransportEligibilityPolicy`, `WorkEligibilityPolicy` и `TravelEligibilityPolicy` используют Capability Registry, precomputed RequirementEvaluator decision, permission decision, operational state и structural condition. Domain не импортирует RequirementEvaluator или OwnershipService. Missing capabilities вычисляются одним registry pass без category checks.

`ActiveVehiclePolicy` возвращает owner-neutral versioned selection. Связь выбора с player, family или business будет выполнена Application/Ownership на последующих этапах.

### Giant Escape 3

Giant Escape 3 используется как единственная эталонная конфигурация Phase 2: 12.3 kg, 32 km/h, structural health 10 000, chain service 375 SUM, full repair base 2 000 SUM и resale base 15 000 SUM. Конкретный Product ID находится только в Catalog и tests; production Domain принимает универсальную конфигурацию и не содержит логики велосипеда.

### Phase 2 Architecture Gates

Architecture tests запрещают Phase 2 imports Application/Infrastructure/Bot, ссылки на GameState, Repository, Scheduler, UnitOfWork, Composition Root, EventBus, Telegram, JSON и PostgreSQL, model/category literals, DTO/API declarations, system clock reads и ручное создание Error/DomainError. Отдельно проверяется отсутствие owner/tenant/permission в `VehicleState` и размещение Phase 1 DTO в Application contracts.

## Следующий этап Roadmap

Phase 3 Persistence должен добавить async Transport Repository port и storage implementation поверх текущего UnitOfWork, не изменяя завершённый Core Domain. Application, integrations, Scheduler workflows, statistics и Telegram UI остаются отдельными последующими фазами утверждённого Roadmap.

Phase 3 не должен менять Core Domain contracts без отдельного архитектурного согласования.
