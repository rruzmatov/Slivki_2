"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransportErrorFactory = void 0;
const errors_1 = require("./errors");
const definitions = {
    TRANSPORT_CAPABILITY_CODE_INVALID: {
        message: "Некорректный capability code",
        localizationKey: "transport.error.capability_code_invalid",
        retryable: false
    },
    TRANSPORT_CAPABILITY_DUPLICATE: {
        message: "Capability зарегистрирован повторно",
        localizationKey: "transport.error.capability_duplicate",
        retryable: false
    },
    TRANSPORT_CAPABILITY_UNKNOWN: {
        message: "Capability не зарегистрирован",
        localizationKey: "transport.error.capability_unknown",
        retryable: false
    },
    TRANSPORT_CAPABILITY_DEPENDENCY_CYCLE: {
        message: "Capability graph содержит цикл",
        localizationKey: "transport.error.capability_dependency_cycle",
        retryable: false
    },
    TRANSPORT_CAPABILITY_DEPENDENCY_UNSATISFIED: {
        message: "Capability dependencies не выполнены",
        localizationKey: "transport.error.capability_dependency_unsatisfied",
        retryable: false
    },
    TRANSPORT_CAPABILITY_PARAMETER_INVALID: {
        message: "Capability parameters не соответствуют контракту",
        localizationKey: "transport.error.capability_parameter_invalid",
        retryable: false
    },
    TRANSPORT_ENERGY_TYPE_CODE_INVALID: {
        message: "Некорректный energy type code",
        localizationKey: "transport.error.energy_type_code_invalid",
        retryable: false
    },
    TRANSPORT_ENERGY_TYPE_DUPLICATE: {
        message: "Energy type зарегистрирован повторно",
        localizationKey: "transport.error.energy_type_duplicate",
        retryable: false
    },
    TRANSPORT_ENERGY_TYPE_UNKNOWN: {
        message: "Energy type не зарегистрирован",
        localizationKey: "transport.error.energy_type_unknown",
        retryable: false
    },
    TRANSPORT_ENERGY_PROFILE_INVALID: {
        message: "Energy profile не соответствует контракту",
        localizationKey: "transport.error.energy_profile_invalid",
        retryable: false
    },
    TRANSPORT_CATALOG_REVISION_INVALID: {
        message: "Некорректная revision транспортного каталога",
        localizationKey: "transport.error.catalog_revision_invalid",
        retryable: false
    },
    TRANSPORT_IDENTIFIER_INVALID: {
        message: "Некорректный идентификатор Transport",
        localizationKey: "transport.error.identifier_invalid",
        retryable: false
    },
    TRANSPORT_TIMESTAMP_INVALID: {
        message: "Некорректная временная метка Transport",
        localizationKey: "transport.error.timestamp_invalid",
        retryable: false
    },
    TRANSPORT_MILEAGE_INVALID: {
        message: "Некорректный пробег",
        localizationKey: "transport.error.mileage_invalid",
        retryable: false
    },
    TRANSPORT_MILEAGE_DECREASE: {
        message: "Пробег не может уменьшаться",
        localizationKey: "transport.error.mileage_decrease",
        retryable: false
    },
    TRANSPORT_MILEAGE_OVERFLOW: {
        message: "Пробег превышает допустимый диапазон",
        localizationKey: "transport.error.mileage_overflow",
        retryable: false
    },
    TRANSPORT_STRUCTURAL_HEALTH_INVALID: {
        message: "Некорректное структурное состояние транспорта",
        localizationKey: "transport.error.structural_health_invalid",
        retryable: false
    },
    TRANSPORT_DAMAGE_INVALID: {
        message: "Некорректное повреждение транспорта",
        localizationKey: "transport.error.damage_invalid",
        retryable: false
    },
    TRANSPORT_USAGE_INVALID: {
        message: "Некорректное использование транспорта",
        localizationKey: "transport.error.usage_invalid",
        retryable: false
    },
    TRANSPORT_USAGE_TRANSITION_FORBIDDEN: {
        message: "Переход состояния использования запрещён",
        localizationKey: "transport.error.usage_transition_forbidden",
        retryable: false
    },
    TRANSPORT_USAGE_DISTANCE_INVALID: {
        message: "Некорректная дистанция использования",
        localizationKey: "transport.error.usage_distance_invalid",
        retryable: false
    },
    TRANSPORT_USAGE_ALREADY_ACTIVE: {
        message: "Транспорт уже используется",
        localizationKey: "transport.error.usage_already_active",
        retryable: false
    },
    TRANSPORT_USAGE_NOT_ACTIVE: {
        message: "Активное использование транспорта не найдено",
        localizationKey: "transport.error.usage_not_active",
        retryable: false
    },
    TRANSPORT_USAGE_REASON_REQUIRED: {
        message: "Причина отмены использования обязательна",
        localizationKey: "transport.error.usage_reason_required",
        retryable: false
    },
    TRANSPORT_STATE_INVALID: {
        message: "Некорректное состояние транспорта",
        localizationKey: "transport.error.state_invalid",
        retryable: false
    },
    TRANSPORT_STATE_TRANSITION_FORBIDDEN: {
        message: "Переход состояния транспорта запрещён",
        localizationKey: "transport.error.state_transition_forbidden",
        retryable: false
    },
    TRANSPORT_STATE_INVARIANT_VIOLATION: {
        message: "Нарушен инвариант состояния транспорта",
        localizationKey: "transport.error.state_invariant_violation",
        retryable: false
    },
    TRANSPORT_VEHICLE_VERSION_INVALID: {
        message: "Некорректная версия транспорта",
        localizationKey: "transport.error.vehicle_version_invalid",
        retryable: false
    },
    TRANSPORT_VEHICLE_VERSION_CONFLICT: {
        message: "Версия транспорта изменилась",
        localizationKey: "transport.error.vehicle_version_conflict",
        retryable: true
    },
    TRANSPORT_VEHICLE_BROKEN: {
        message: "Сломанный транспорт нельзя использовать",
        localizationKey: "transport.error.vehicle_broken",
        retryable: false
    },
    TRANSPORT_MAINTENANCE_TASK_INVALID: {
        message: "Некорректная задача обслуживания",
        localizationKey: "transport.error.maintenance_task_invalid",
        retryable: false
    },
    TRANSPORT_MAINTENANCE_INTERVAL_INVALID: {
        message: "Некорректный интервал обслуживания",
        localizationKey: "transport.error.maintenance_interval_invalid",
        retryable: false
    },
    TRANSPORT_MAINTENANCE_SCHEDULE_INVALID: {
        message: "Некорректный график обслуживания",
        localizationKey: "transport.error.maintenance_schedule_invalid",
        retryable: false
    },
    TRANSPORT_MAINTENANCE_NOT_ELIGIBLE: {
        message: "Обслуживание пока недоступно",
        localizationKey: "transport.error.maintenance_not_eligible",
        retryable: false
    },
    TRANSPORT_MAINTENANCE_QUOTE_INVALID: {
        message: "Некорректная квота обслуживания",
        localizationKey: "transport.error.maintenance_quote_invalid",
        retryable: false
    },
    TRANSPORT_REPAIR_REASON_REQUIRED: {
        message: "Причина ремонта обязательна",
        localizationKey: "transport.error.repair_reason_required",
        retryable: false
    },
    TRANSPORT_REPAIR_NOT_REQUIRED: {
        message: "Ремонт не требуется",
        localizationKey: "transport.error.repair_not_required",
        retryable: false
    },
    TRANSPORT_REPAIR_QUOTE_INVALID: {
        message: "Некорректная квота ремонта",
        localizationKey: "transport.error.repair_quote_invalid",
        retryable: false
    },
    TRANSPORT_REPAIR_RESULT_INVALID: {
        message: "Некорректный результат ремонта",
        localizationKey: "transport.error.repair_result_invalid",
        retryable: false
    },
    TRANSPORT_POLICY_VERSION_INVALID: {
        message: "Некорректная версия доменной политики",
        localizationKey: "transport.error.policy_version_invalid",
        retryable: false
    },
    TRANSPORT_PRICING_CONTEXT_INVALID: {
        message: "Некорректный контекст расчёта цены",
        localizationKey: "transport.error.pricing_context_invalid",
        retryable: false
    },
    TRANSPORT_PRICING_BREAKDOWN_INVALID: {
        message: "Некорректная детализация цены",
        localizationKey: "transport.error.pricing_breakdown_invalid",
        retryable: false
    },
    TRANSPORT_PRICING_OVERFLOW: {
        message: "Результат расчёта цены превышает допустимый диапазон",
        localizationKey: "transport.error.pricing_overflow",
        retryable: false
    },
    TRANSPORT_ELIGIBILITY_INVALID: {
        message: "Некорректные условия доступности транспорта",
        localizationKey: "transport.error.eligibility_invalid",
        retryable: false
    },
    TRANSPORT_ELIGIBILITY_DENIED: {
        message: "Транспорт не соответствует условиям использования",
        localizationKey: "transport.error.eligibility_denied",
        retryable: false
    },
    TRANSPORT_ACTIVE_VEHICLE_INVALID: {
        message: "Некорректный активный транспорт",
        localizationKey: "transport.error.active_vehicle_invalid",
        retryable: false
    }
};
exports.TransportErrorFactory = Object.freeze({
    create(code, details = {}) {
        const definition = definitions[code];
        return new errors_1.DomainError(definition.message, code, {
            localizationKey: definition.localizationKey,
            details,
            retryable: definition.retryable
        });
    }
});
