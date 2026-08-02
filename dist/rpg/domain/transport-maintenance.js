"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenancePolicy = exports.MaintenanceSchedule = exports.ServiceInterval = void 0;
exports.validateMaintenanceQuote = validateMaintenanceQuote;
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
const transport_pricing_1 = require("./transport-pricing");
class ServiceInterval {
    distanceMeters;
    timeMilliseconds;
    usageCount;
    earlyWindow;
    criticalOverdue;
    constructor(definition) {
        validateThreshold(definition, "interval", true, 1);
        validateThreshold(definition.earlyWindow ?? {}, "earlyWindow", false, 0);
        validateThreshold(definition.criticalOverdue ?? {}, "criticalOverdue", false, 1);
        assertWindowWithinInterval(definition.earlyWindow ?? {}, definition);
        assertThresholdAligned(definition.criticalOverdue ?? {}, definition);
        this.distanceMeters = definition.distanceMeters;
        this.timeMilliseconds = definition.timeMilliseconds;
        this.usageCount = definition.usageCount;
        this.earlyWindow = Object.freeze({ ...(definition.earlyWindow ?? {}) });
        this.criticalOverdue = Object.freeze({ ...(definition.criticalOverdue ?? {}) });
        Object.freeze(this);
    }
}
exports.ServiceInterval = ServiceInterval;
class MaintenanceSchedule {
    version;
    checkpoints;
    constructor(checkpoints, version) {
        this.version = version;
        this.checkpoints = new Map(checkpoints.map((checkpoint) => [checkpoint.taskCode, freezeCheckpoint(checkpoint)]));
        Object.freeze(this);
    }
    static create(definitions, context) {
        validateMaintenanceContext(context);
        const codes = new Set();
        const checkpoints = definitions.map((definition) => {
            validateTaskDefinition(definition);
            if (codes.has(definition.code)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { code: definition.code });
            }
            codes.add(definition.code);
            return {
                taskCode: definition.code,
                servicedAt: context.at,
                mileageMeters: context.mileageMeters,
                usageCount: context.usageCount
            };
        });
        return new MaintenanceSchedule(checkpoints, 1);
    }
    static restore(snapshot) {
        (0, transport_domain_validation_1.assertSafeInteger)(snapshot.version, "schedule.version", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", 1);
        const codes = new Set();
        for (const checkpoint of snapshot.checkpoints) {
            validateCheckpoint(checkpoint);
            if (codes.has(checkpoint.taskCode)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { taskCode: checkpoint.taskCode });
            }
            codes.add(checkpoint.taskCode);
        }
        return new MaintenanceSchedule(snapshot.checkpoints, snapshot.version);
    }
    getCheckpoint(taskCode) {
        const checkpoint = this.checkpoints.get(taskCode);
        if (!checkpoint) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { taskCode });
        }
        return checkpoint;
    }
    withCompletedTasks(taskCodes, context) {
        validateMaintenanceContext(context);
        const selected = new Set(taskCodes);
        if (selected.size !== taskCodes.length || selected.size === 0) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { field: "taskCodes" });
        }
        for (const taskCode of selected)
            this.getCheckpoint(taskCode);
        for (const taskCode of selected)
            assertContextNotBeforeCheckpoint(context, this.getCheckpoint(taskCode));
        const next = [...this.checkpoints.values()].map((checkpoint) => selected.has(checkpoint.taskCode)
            ? {
                taskCode: checkpoint.taskCode,
                servicedAt: context.at,
                mileageMeters: context.mileageMeters,
                usageCount: context.usageCount
            }
            : checkpoint);
        return new MaintenanceSchedule(next, this.version + 1);
    }
    snapshot() {
        return Object.freeze({
            checkpoints: Object.freeze([...this.checkpoints.values()].map(freezeCheckpoint)),
            version: this.version
        });
    }
}
exports.MaintenanceSchedule = MaintenanceSchedule;
class MaintenancePolicy {
    pricing;
    definitions;
    constructor(definitions, pricing) {
        this.pricing = pricing;
        const byCode = new Map();
        for (const definition of definitions) {
            validateTaskDefinition(definition);
            if (byCode.has(definition.code)) {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { code: definition.code });
            }
            byCode.set(definition.code, Object.freeze({ ...definition }));
        }
        if (byCode.size === 0) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { field: "definitions" });
        }
        this.definitions = byCode;
    }
    createSchedule(context) {
        return MaintenanceSchedule.create([...this.definitions.values()], context);
    }
    assess(schedule, context, taskCode) {
        validateMaintenanceContext(context);
        const definition = this.getDefinition(taskCode);
        const checkpoint = schedule.getCheckpoint(taskCode);
        assertContextNotBeforeCheckpoint(context, checkpoint);
        const metrics = assessmentMetrics(definition.interval, checkpoint, context);
        const status = resolveMaintenanceStatus(metrics);
        return Object.freeze({
            taskCode,
            status,
            dueAt: metrics.time?.dueAt,
            dueMileageMeters: metrics.distance?.dueValue,
            dueUsageCount: metrics.usage?.dueValue,
            overdueMultiplierBps: status === "critical_overdue"
                ? definition.criticalOverdueMultiplierBps
                : status === "overdue"
                    ? definition.overdueMultiplierBps
                    : 10_000
        });
    }
    createQuote(input) {
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.quoteId, "quoteId");
        (0, transport_domain_validation_1.assertTransportIdentifier)(input.vehicleId, "vehicleId");
        const taskCodes = normalizeTaskCodes(input.taskCodes);
        const assessments = taskCodes.map((code) => this.assess(input.schedule, input.context, code));
        if (assessments.some((assessment) => assessment.status === "not_due")) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_NOT_ELIGIBLE", { vehicleId: input.vehicleId });
        }
        const createdAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(input.createdAt, "createdAt");
        const expiresAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(input.expiresAt, "expiresAt");
        if (expiresAtMs <= createdAtMs) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { field: "expiresAt" });
        }
        const overdueMultiplierBps = Math.max(...assessments.map((assessment) => assessment.overdueMultiplierBps));
        const breakdown = this.pricing.quote({
            ...input.pricingContext,
            taskCount: taskCodes.length,
            overdueMultiplierBps
        });
        (0, transport_pricing_1.validatePricingBreakdown)(breakdown, this.pricing.version);
        return freezeMaintenanceQuote({
            quoteId: input.quoteId,
            vehicleId: input.vehicleId,
            taskCodes,
            scheduleVersion: input.schedule.version,
            assessments,
            cost: { amount: breakdown.totalAmount, currency: breakdown.currency, breakdown },
            policyVersion: this.pricing.version,
            createdAt: input.createdAt,
            expiresAt: input.expiresAt
        });
    }
    complete(schedule, quote, context) {
        validateMaintenanceQuote(quote);
        validateMaintenanceContext(context);
        const completedAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(context.at, "completedAt");
        if (schedule.version !== quote.scheduleVersion || quote.policyVersion !== this.pricing.version ||
            completedAtMs < (0, transport_domain_validation_1.timestampMilliseconds)(quote.createdAt, "createdAt") ||
            completedAtMs > (0, transport_domain_validation_1.timestampMilliseconds)(quote.expiresAt, "expiresAt")) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
        }
        for (const taskCode of quote.taskCodes) {
            const assessment = this.assess(schedule, context, taskCode);
            if (assessment.status === "not_due") {
                throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_NOT_ELIGIBLE", { taskCode });
            }
        }
        const scheduleAfter = schedule.withCompletedTasks(quote.taskCodes, context);
        return Object.freeze({
            quoteId: quote.quoteId,
            vehicleId: quote.vehicleId,
            completedTaskCodes: quote.taskCodes,
            scheduleBeforeVersion: schedule.version,
            scheduleAfter: scheduleAfter.snapshot(),
            cost: quote.cost,
            completedAt: context.at
        });
    }
    getDefinition(taskCode) {
        const definition = this.definitions.get(taskCode);
        if (!definition)
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { taskCode });
        return definition;
    }
}
exports.MaintenancePolicy = MaintenancePolicy;
function validateMaintenanceQuote(quote) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(quote.quoteId, "quoteId");
    (0, transport_domain_validation_1.assertTransportIdentifier)(quote.vehicleId, "vehicleId");
    normalizeTaskCodes(quote.taskCodes);
    (0, transport_domain_validation_1.assertSafeInteger)(quote.scheduleVersion, "scheduleVersion", "TRANSPORT_MAINTENANCE_QUOTE_INVALID", 1);
    if (quote.assessments.length !== quote.taskCodes.length) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    for (const [index, assessment] of quote.assessments.entries()) {
        const taskCode = quote.taskCodes[index];
        if (assessment.taskCode !== taskCode || assessment.status === "not_due") {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { taskCode });
        }
        (0, transport_domain_validation_1.assertSafeInteger)(assessment.overdueMultiplierBps, "assessment.overdueMultiplierBps", "TRANSPORT_MAINTENANCE_QUOTE_INVALID", 10_000, 1_000_000);
        if (assessment.dueAt)
            (0, transport_domain_validation_1.timestampMilliseconds)(assessment.dueAt, "assessment.dueAt");
        if (assessment.dueMileageMeters !== undefined) {
            (0, transport_domain_validation_1.assertSafeInteger)(assessment.dueMileageMeters, "assessment.dueMileageMeters", "TRANSPORT_MAINTENANCE_QUOTE_INVALID");
        }
        if (assessment.dueUsageCount !== undefined) {
            (0, transport_domain_validation_1.assertSafeInteger)(assessment.dueUsageCount, "assessment.dueUsageCount", "TRANSPORT_MAINTENANCE_QUOTE_INVALID");
        }
    }
    const createdAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(quote.createdAt, "createdAt");
    const expiresAtMs = (0, transport_domain_validation_1.timestampMilliseconds)(quote.expiresAt, "expiresAt");
    if (expiresAtMs <= createdAtMs) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    (0, transport_pricing_1.validatePricingBreakdown)(quote.cost.breakdown, quote.policyVersion);
    if (quote.cost.amount !== quote.cost.breakdown.totalAmount || quote.cost.currency !== quote.cost.breakdown.currency) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
}
function assessmentMetrics(interval, checkpoint, context) {
    return {
        distance: interval.distanceMeters === undefined ? undefined : numericMetric(context.mileageMeters, safeMetricSum(checkpoint.mileageMeters, interval.distanceMeters, "dueMileageMeters"), interval.earlyWindow.distanceMeters ?? 0, interval.criticalOverdue.distanceMeters),
        time: interval.timeMilliseconds === undefined ? undefined : timeMetric(context.at, checkpoint.servicedAt, interval.timeMilliseconds, interval.earlyWindow.timeMilliseconds ?? 0, interval.criticalOverdue.timeMilliseconds),
        usage: interval.usageCount === undefined ? undefined : numericMetric(context.usageCount, safeMetricSum(checkpoint.usageCount, interval.usageCount, "dueUsageCount"), interval.earlyWindow.usageCount ?? 0, interval.criticalOverdue.usageCount)
    };
}
function numericMetric(current, due, early, critical) {
    return {
        eligible: current >= due - early,
        due: current >= due,
        overdue: current > due,
        critical: critical !== undefined && current >= due + critical,
        dueValue: due
    };
}
function timeMetric(currentAt, servicedAt, interval, early, critical) {
    const current = (0, transport_domain_validation_1.timestampMilliseconds)(currentAt, "context.at");
    const due = (0, transport_domain_validation_1.timestampMilliseconds)(servicedAt, "checkpoint.servicedAt") + interval;
    if (!Number.isSafeInteger(due) || Math.abs(due) > 8_640_000_000_000_000) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { field: "dueAt" });
    }
    return {
        eligible: current >= due - early,
        due: current >= due,
        overdue: current > due,
        critical: critical !== undefined && current >= due + critical,
        dueAt: new Date(due).toISOString()
    };
}
function resolveMaintenanceStatus(metrics) {
    const values = Object.values(metrics).filter((value) => Boolean(value));
    if (values.some((value) => value.critical))
        return "critical_overdue";
    if (values.some((value) => value.overdue))
        return "overdue";
    if (values.some((value) => value.due))
        return "due";
    if (values.some((value) => value.eligible))
        return "eligible";
    return "not_due";
}
function validateTaskDefinition(definition) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(definition.code, "maintenanceTask.code");
    (0, transport_domain_validation_1.assertTransportIdentifier)(definition.localizationKey, "maintenanceTask.localizationKey");
    if (!(definition.interval instanceof ServiceInterval)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { taskCode: definition.code });
    }
    (0, transport_domain_validation_1.assertSafeInteger)(definition.version, "maintenanceTask.version", "TRANSPORT_MAINTENANCE_TASK_INVALID", 1);
    (0, transport_domain_validation_1.assertSafeInteger)(definition.overdueMultiplierBps, "overdueMultiplierBps", "TRANSPORT_MAINTENANCE_TASK_INVALID", 10_000, 1_000_000);
    (0, transport_domain_validation_1.assertSafeInteger)(definition.criticalOverdueMultiplierBps, "criticalOverdueMultiplierBps", "TRANSPORT_MAINTENANCE_TASK_INVALID", definition.overdueMultiplierBps, 1_000_000);
}
function validateThreshold(threshold, field, requireOne, minimum) {
    const values = [threshold.distanceMeters, threshold.timeMilliseconds, threshold.usageCount];
    if (requireOne && values.every((value) => value === undefined)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { field });
    }
    for (const [index, value] of values.entries()) {
        if (value !== undefined) {
            (0, transport_domain_validation_1.assertSafeInteger)(value, `${field}.${index}`, "TRANSPORT_MAINTENANCE_INTERVAL_INVALID", minimum);
        }
    }
}
function assertThresholdAligned(threshold, interval) {
    for (const key of ["distanceMeters", "timeMilliseconds", "usageCount"]) {
        if (threshold[key] !== undefined && interval[key] === undefined) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { field: key });
        }
    }
}
function assertWindowWithinInterval(window, interval) {
    for (const key of ["distanceMeters", "timeMilliseconds", "usageCount"]) {
        const windowValue = window[key];
        const intervalValue = interval[key];
        if (windowValue !== undefined && (intervalValue === undefined || windowValue >= intervalValue)) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { field: key });
        }
    }
}
function validateMaintenanceContext(context) {
    (0, transport_domain_validation_1.timestampMilliseconds)(context.at, "maintenance.at");
    (0, transport_domain_validation_1.assertSafeInteger)(context.mileageMeters, "maintenance.mileageMeters", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
    (0, transport_domain_validation_1.assertSafeInteger)(context.usageCount, "maintenance.usageCount", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
}
function validateCheckpoint(checkpoint) {
    (0, transport_domain_validation_1.assertTransportIdentifier)(checkpoint.taskCode, "checkpoint.taskCode");
    (0, transport_domain_validation_1.timestampMilliseconds)(checkpoint.servicedAt, "checkpoint.servicedAt");
    (0, transport_domain_validation_1.assertSafeInteger)(checkpoint.mileageMeters, "checkpoint.mileageMeters", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
    (0, transport_domain_validation_1.assertSafeInteger)(checkpoint.usageCount, "checkpoint.usageCount", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
}
function assertContextNotBeforeCheckpoint(context, checkpoint) {
    if (context.mileageMeters < checkpoint.mileageMeters || context.usageCount < checkpoint.usageCount ||
        (0, transport_domain_validation_1.timestampMilliseconds)(context.at, "context.at") < (0, transport_domain_validation_1.timestampMilliseconds)(checkpoint.servicedAt, "checkpoint.servicedAt")) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { taskCode: checkpoint.taskCode });
    }
}
function normalizeTaskCodes(taskCodes) {
    const normalized = taskCodes.map((code) => (0, transport_domain_validation_1.assertTransportIdentifier)(code, "taskCode"));
    if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { field: "taskCodes" });
    }
    return Object.freeze([...normalized]);
}
function freezeCheckpoint(checkpoint) {
    return Object.freeze({ ...checkpoint });
}
function freezeMaintenanceQuote(quote) {
    return Object.freeze({
        ...quote,
        taskCodes: Object.freeze([...quote.taskCodes]),
        assessments: Object.freeze(quote.assessments.map((assessment) => Object.freeze({ ...assessment }))),
        cost: Object.freeze({ ...quote.cost })
    });
}
function safeMetricSum(left, right, field) {
    const sum = BigInt(left) + BigInt(right);
    if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { field });
    }
    return Number(sum);
}
