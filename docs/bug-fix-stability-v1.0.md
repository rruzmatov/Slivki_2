# Мир Сливки

## Bug Fix & Stability v1.0

Статус: реализовано и проверено.

## Цель

Стабилизировать существующий Telegram- и RPG-функционал без разработки новых игровых систем и без изменения утверждённых границ Inventory, Ownership, Economy, Shop, Unlocks, UnitOfWork, EventBus, Scheduler и Composition Root.

## Исправленные дефекты

- Удалён конфликтующий startup-фрагмент с отсутствующими legacy-модулями; основной `/start` и существующие команды сохранены.
- `tg-admin` и `untg-admin` проверяют права бота, редактируемость цели, ответ Telegram и итоговый `getChatMember`.
- Mute блокирует все классы контента и реакции. Unmute проверяет реальное состояние после API. Временные муты сохраняются и восстанавливаются после перезапуска.
- Dice и Casino используют криптографический генератор и независимое решение 50/50. Денежный settlement стал атомарным, неотрицательным и идемпотентным.
- Игровая карточка показывает ставку, коэффициент, выигрыш/проигрыш, баланс до/после и кнопку повторной игры.
- Брак показывает продолжительность до минут, дату свадьбы и срок до годовщины в `/partner`, `/profile` и списке браков.
- RP выбирает текст и доступные Premium Emoji без немедленного повтора, сохраняя обычный emoji fallback.
- Викторина получила 41 вопрос, категории, сложность, неповторяющийся пул, durable active state, таймер, статистику и рейтинг.
- `/tagall` получил прогресс, `/tagpause`, `/tagresume`, `/tagstop` и `/stopcall`; остановка освобождает ожидающий таймер.
- `/diagnostics` проверяет Telegram API, permissions, Scheduler, EventBus, Repository, Composition Root, JSON, Storage, Premium Emoji и callback routing.
- `/reportbug` атомарно сохраняет chat/message/command/user/correlation/time/log/description с ограничением истории.
- Все callback обёрнуты общей защитой, дедупликацией `query.id`, correlation logging и ответом для устаревших кнопок.
- `/slowmode` подключён к существующему durable enforcement вместо неподдерживаемого поля Bot API.
- Требования активов для профессий больше нельзя обходить: недоступные будущие категории блокируются с точной причиной.
- Убраны синхронные полные записи `users.json`, `stats.json` и `chats.json` на каждое сообщение. Записи коалесцируются, повторяются после I/O-ошибки и принудительно flush-ятся при shutdown.
- Ограничен рост runtime error, callback, support, pending marriage и auto-kick history state.
- Повреждённые legacy JSON сохраняются как `.corrupt-*` до восстановительной записи.

## Безопасность

- `node-telegram-bot-api` обновлён с `0.67.0` до `1.2.0`.
- Выполнена миграция на named CommonJS export, `reply_parameters`, `link_preview_options`, актуальную сигнатуру `restrictChatMember` и `stopPolling`.
- `npm audit --omit=dev`: 0 уязвимостей.
- Покупки, подарки, ставки и quiz rewards защищены существующими либо добавленными idempotency keys.

## Новые модули

- `src/telegram-moderation.js` — permissions и postcondition-проверки moderation.
- `src/betting-games.js` — честный outcome и визуальные результаты игр.
- `src/marriage-time.js` — единый formatter времени брака.
- `src/rp-presentation.js` — выбор RP-текстов и Premium Emoji.
- `src/quiz.js` — каталог и durable state викторины.
- `src/tag-call-controller.js` — state machine массового вызова.
- `src/diagnostics.js` — локальные и архитектурные health checks.
- `src/bug-report-store.js` — bounded atomic bug-report storage.
- `src/deferred-json-writer.js` — коалесцированная JSON-запись с retry/flush.
- `src/json-file-safety.js` — единая защита повреждённых JSON от перезаписи.

## Telegram-команды

Добавлены: `/quizstats`, `/tagpause`, `/tagresume`, `/tagstop`, `/stopcall`, `/diagnostics`, `/reportbug`.

Исправлены: `/start`, `/dice`, `/casino`, `/quiz`, `/profile`, `/partner`, `/tagall`, `/slowmode`, `/mute`, `/unmute`, `tg-admin`, `untg-admin`, команды reply-based модулей после миграции Telegram-клиента.

## Тесты

Добавлены тесты fairness на 100 000 раундов для каждой игры, atomic/idempotent settlement, moderation permissions, marriage/RP presentation, quiz persistence/pool/stats/timer, tag call state machine, diagnostics, bug report retention, deferred writes, Family requirements, Telegram API migration, metadata команд, локальные зависимости и циклы JavaScript.

Существующие RPG-тесты продолжают проверять Inventory/Ownership, Economy/Shop, Unlocks, gifts, UnitOfWork rollback, EventBus commit boundary, durable Scheduler, retention, Schema Registry и JSON corruption recovery.

## Архитектурный аудит

- Application/Domain не импортируют GameState или Infrastructure.
- Telegram RPG layer не импортирует Repository/adapters.
- `new EventBus()` существует только в Composition Root.
- Repository ports возвращают Promise.
- Production TypeScript и JavaScript не имеют циклических локальных зависимостей.
- Shop, Inventory, Ownership, Economy и Unlocks используют одну UnitOfWork transaction boundary.
- События публикуются после commit и имеют versioned envelope.
- Runtime History/Outbox/Inbox/Idempotency/Scheduler покрыты retention policy.
- Новые Transport, Jobs, Countries, Travel, Business и Marketplace не разрабатывались.

## PostgreSQL

Application contracts и Repository ports готовы к async PostgreSQL adapters. Для перехода нужны отдельная схема/миграции, SQL-реализации UnitOfWork и repositories, транзакционный outbox worker, scheduler leasing через `FOR UPDATE SKIP LOCKED`, индексы по owner/product/status/runAt и нагрузочные тесты. Внешние application API менять не требуется.

## Следующий этап

Transport v1 можно проектировать поверх текущих Catalog, Inventory, Ownership, Economy, Shop, Unlock, EventBus, Scheduler и UnitOfWork контрактов. Bug Fix & Stability v1.0 не оставляет архитектурного блокера для этапа проектирования Transport v1.
