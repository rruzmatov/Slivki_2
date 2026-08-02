import {
  assertSafeInteger,
  assertTransportIdentifier,
  timestampMilliseconds
} from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";
import {
  type MaintenancePricingContext,
  type MaintenancePricingPolicy,
  type PricingBreakdown,
  validatePricingBreakdown
} from "./transport-pricing";

export interface ServiceThreshold {
  readonly distanceMeters?: number;
  readonly timeMilliseconds?: number;
  readonly usageCount?: number;
}

export interface ServiceIntervalDefinition extends ServiceThreshold {
  readonly earlyWindow?: ServiceThreshold;
  readonly criticalOverdue?: ServiceThreshold;
}

export class ServiceInterval {
  readonly distanceMeters?: number;
  readonly timeMilliseconds?: number;
  readonly usageCount?: number;
  readonly earlyWindow: Readonly<ServiceThreshold>;
  readonly criticalOverdue: Readonly<ServiceThreshold>;

  constructor(definition: ServiceIntervalDefinition) {
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

export interface MaintenanceTaskDefinition {
  readonly code: string;
  readonly localizationKey: string;
  readonly interval: ServiceInterval;
  readonly overdueMultiplierBps: number;
  readonly criticalOverdueMultiplierBps: number;
  readonly version: number;
}

export interface MaintenanceCheckpoint {
  readonly taskCode: string;
  readonly servicedAt: string;
  readonly mileageMeters: number;
  readonly usageCount: number;
}

export interface MaintenanceScheduleSnapshot {
  readonly checkpoints: readonly MaintenanceCheckpoint[];
  readonly version: number;
}

export interface MaintenanceContext {
  readonly at: string;
  readonly mileageMeters: number;
  readonly usageCount: number;
}

export type MaintenanceStatus = "not_due" | "eligible" | "due" | "overdue" | "critical_overdue";

export interface MaintenanceAssessment {
  readonly taskCode: string;
  readonly status: MaintenanceStatus;
  readonly dueAt?: string;
  readonly dueMileageMeters?: number;
  readonly dueUsageCount?: number;
  readonly overdueMultiplierBps: number;
}

export interface MaintenanceQuote {
  readonly quoteId: string;
  readonly vehicleId: string;
  readonly taskCodes: readonly string[];
  readonly scheduleVersion: number;
  readonly assessments: readonly MaintenanceAssessment[];
  readonly cost: Readonly<{ amount: number; currency: string; breakdown: PricingBreakdown }>;
  readonly policyVersion: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateMaintenanceQuoteInput {
  readonly quoteId: string;
  readonly vehicleId: string;
  readonly taskCodes: readonly string[];
  readonly schedule: MaintenanceSchedule;
  readonly context: MaintenanceContext;
  readonly pricingContext: Omit<MaintenancePricingContext, "taskCount" | "overdueMultiplierBps">;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface MaintenanceResult {
  readonly quoteId: string;
  readonly vehicleId: string;
  readonly completedTaskCodes: readonly string[];
  readonly scheduleBeforeVersion: number;
  readonly scheduleAfter: MaintenanceScheduleSnapshot;
  readonly cost: MaintenanceQuote["cost"];
  readonly completedAt: string;
}

export class MaintenanceSchedule {
  private readonly checkpoints: ReadonlyMap<string, MaintenanceCheckpoint>;

  private constructor(checkpoints: readonly MaintenanceCheckpoint[], readonly version: number) {
    this.checkpoints = new Map(checkpoints.map((checkpoint) => [checkpoint.taskCode, freezeCheckpoint(checkpoint)]));
    Object.freeze(this);
  }

  static create(definitions: readonly MaintenanceTaskDefinition[], context: MaintenanceContext): MaintenanceSchedule {
    validateMaintenanceContext(context);
    const codes = new Set<string>();
    const checkpoints = definitions.map((definition) => {
      validateTaskDefinition(definition);
      if (codes.has(definition.code)) {
        throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { code: definition.code });
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

  static restore(snapshot: MaintenanceScheduleSnapshot): MaintenanceSchedule {
    assertSafeInteger(snapshot.version, "schedule.version", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", 1);
    const codes = new Set<string>();
    for (const checkpoint of snapshot.checkpoints) {
      validateCheckpoint(checkpoint);
      if (codes.has(checkpoint.taskCode)) {
        throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { taskCode: checkpoint.taskCode });
      }
      codes.add(checkpoint.taskCode);
    }
    return new MaintenanceSchedule(snapshot.checkpoints, snapshot.version);
  }

  getCheckpoint(taskCode: string): MaintenanceCheckpoint {
    const checkpoint = this.checkpoints.get(taskCode);
    if (!checkpoint) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { taskCode });
    }
    return checkpoint;
  }

  withCompletedTasks(taskCodes: readonly string[], context: MaintenanceContext): MaintenanceSchedule {
    validateMaintenanceContext(context);
    const selected = new Set(taskCodes);
    if (selected.size !== taskCodes.length || selected.size === 0) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { field: "taskCodes" });
    }
    for (const taskCode of selected) this.getCheckpoint(taskCode);
    for (const taskCode of selected) assertContextNotBeforeCheckpoint(context, this.getCheckpoint(taskCode));
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

  snapshot(): MaintenanceScheduleSnapshot {
    return Object.freeze({
      checkpoints: Object.freeze([...this.checkpoints.values()].map(freezeCheckpoint)),
      version: this.version
    });
  }
}

export class MaintenancePolicy {
  private readonly definitions: ReadonlyMap<string, MaintenanceTaskDefinition>;

  constructor(definitions: readonly MaintenanceTaskDefinition[], private readonly pricing: MaintenancePricingPolicy) {
    const byCode = new Map<string, MaintenanceTaskDefinition>();
    for (const definition of definitions) {
      validateTaskDefinition(definition);
      if (byCode.has(definition.code)) {
        throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { code: definition.code });
      }
      byCode.set(definition.code, Object.freeze({ ...definition }));
    }
    if (byCode.size === 0) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { field: "definitions" });
    }
    this.definitions = byCode;
  }

  createSchedule(context: MaintenanceContext): MaintenanceSchedule {
    return MaintenanceSchedule.create([...this.definitions.values()], context);
  }

  assess(schedule: MaintenanceSchedule, context: MaintenanceContext, taskCode: string): MaintenanceAssessment {
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

  createQuote(input: CreateMaintenanceQuoteInput): MaintenanceQuote {
    assertTransportIdentifier(input.quoteId, "quoteId");
    assertTransportIdentifier(input.vehicleId, "vehicleId");
    const taskCodes = normalizeTaskCodes(input.taskCodes);
    const assessments = taskCodes.map((code) => this.assess(input.schedule, input.context, code));
    if (assessments.some((assessment) => assessment.status === "not_due")) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_NOT_ELIGIBLE", { vehicleId: input.vehicleId });
    }
    const createdAtMs = timestampMilliseconds(input.createdAt, "createdAt");
    const expiresAtMs = timestampMilliseconds(input.expiresAt, "expiresAt");
    if (expiresAtMs <= createdAtMs) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { field: "expiresAt" });
    }
    const overdueMultiplierBps = Math.max(...assessments.map((assessment) => assessment.overdueMultiplierBps));
    const breakdown = this.pricing.quote({
      ...input.pricingContext,
      taskCount: taskCodes.length,
      overdueMultiplierBps
    });
    validatePricingBreakdown(breakdown, this.pricing.version);
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

  complete(
    schedule: MaintenanceSchedule,
    quote: MaintenanceQuote,
    context: MaintenanceContext
  ): MaintenanceResult {
    validateMaintenanceQuote(quote);
    validateMaintenanceContext(context);
    const completedAtMs = timestampMilliseconds(context.at, "completedAt");
    if (schedule.version !== quote.scheduleVersion || quote.policyVersion !== this.pricing.version ||
      completedAtMs < timestampMilliseconds(quote.createdAt, "createdAt") ||
      completedAtMs > timestampMilliseconds(quote.expiresAt, "expiresAt")) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    for (const taskCode of quote.taskCodes) {
      const assessment = this.assess(schedule, context, taskCode);
      if (assessment.status === "not_due") {
        throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_NOT_ELIGIBLE", { taskCode });
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

  private getDefinition(taskCode: string): MaintenanceTaskDefinition {
    const definition = this.definitions.get(taskCode);
    if (!definition) throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { taskCode });
    return definition;
  }
}

export function validateMaintenanceQuote(quote: MaintenanceQuote): void {
  assertTransportIdentifier(quote.quoteId, "quoteId");
  assertTransportIdentifier(quote.vehicleId, "vehicleId");
  normalizeTaskCodes(quote.taskCodes);
  assertSafeInteger(quote.scheduleVersion, "scheduleVersion", "TRANSPORT_MAINTENANCE_QUOTE_INVALID", 1);
  if (quote.assessments.length !== quote.taskCodes.length) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
  }
  for (const [index, assessment] of quote.assessments.entries()) {
    const taskCode = quote.taskCodes[index];
    if (assessment.taskCode !== taskCode || assessment.status === "not_due") {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { taskCode });
    }
    assertSafeInteger(
      assessment.overdueMultiplierBps,
      "assessment.overdueMultiplierBps",
      "TRANSPORT_MAINTENANCE_QUOTE_INVALID",
      10_000,
      1_000_000
    );
    if (assessment.dueAt) timestampMilliseconds(assessment.dueAt, "assessment.dueAt");
    if (assessment.dueMileageMeters !== undefined) {
      assertSafeInteger(
        assessment.dueMileageMeters,
        "assessment.dueMileageMeters",
        "TRANSPORT_MAINTENANCE_QUOTE_INVALID"
      );
    }
    if (assessment.dueUsageCount !== undefined) {
      assertSafeInteger(
        assessment.dueUsageCount,
        "assessment.dueUsageCount",
        "TRANSPORT_MAINTENANCE_QUOTE_INVALID"
      );
    }
  }
  const createdAtMs = timestampMilliseconds(quote.createdAt, "createdAt");
  const expiresAtMs = timestampMilliseconds(quote.expiresAt, "expiresAt");
  if (expiresAtMs <= createdAtMs) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
  }
  validatePricingBreakdown(quote.cost.breakdown, quote.policyVersion);
  if (quote.cost.amount !== quote.cost.breakdown.totalAmount || quote.cost.currency !== quote.cost.breakdown.currency) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_QUOTE_INVALID", { quoteId: quote.quoteId });
  }
}

interface MetricAssessment {
  readonly eligible: boolean;
  readonly due: boolean;
  readonly overdue: boolean;
  readonly critical: boolean;
  readonly dueValue?: number;
  readonly dueAt?: string;
}

interface AssessmentMetrics {
  readonly distance?: MetricAssessment;
  readonly time?: MetricAssessment;
  readonly usage?: MetricAssessment;
}

function assessmentMetrics(
  interval: ServiceInterval,
  checkpoint: MaintenanceCheckpoint,
  context: MaintenanceContext
): AssessmentMetrics {
  return {
    distance: interval.distanceMeters === undefined ? undefined : numericMetric(
      context.mileageMeters,
      safeMetricSum(checkpoint.mileageMeters, interval.distanceMeters, "dueMileageMeters"),
      interval.earlyWindow.distanceMeters ?? 0,
      interval.criticalOverdue.distanceMeters
    ),
    time: interval.timeMilliseconds === undefined ? undefined : timeMetric(
      context.at,
      checkpoint.servicedAt,
      interval.timeMilliseconds,
      interval.earlyWindow.timeMilliseconds ?? 0,
      interval.criticalOverdue.timeMilliseconds
    ),
    usage: interval.usageCount === undefined ? undefined : numericMetric(
      context.usageCount,
      safeMetricSum(checkpoint.usageCount, interval.usageCount, "dueUsageCount"),
      interval.earlyWindow.usageCount ?? 0,
      interval.criticalOverdue.usageCount
    )
  };
}

function numericMetric(current: number, due: number, early: number, critical?: number): MetricAssessment {
  return {
    eligible: current >= due - early,
    due: current >= due,
    overdue: current > due,
    critical: critical !== undefined && current >= due + critical,
    dueValue: due
  };
}

function timeMetric(currentAt: string, servicedAt: string, interval: number, early: number, critical?: number): MetricAssessment {
  const current = timestampMilliseconds(currentAt, "context.at");
  const due = timestampMilliseconds(servicedAt, "checkpoint.servicedAt") + interval;
  if (!Number.isSafeInteger(due) || Math.abs(due) > 8_640_000_000_000_000) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { field: "dueAt" });
  }
  return {
    eligible: current >= due - early,
    due: current >= due,
    overdue: current > due,
    critical: critical !== undefined && current >= due + critical,
    dueAt: new Date(due).toISOString()
  };
}

function resolveMaintenanceStatus(metrics: AssessmentMetrics): MaintenanceStatus {
  const values = Object.values(metrics).filter((value): value is MetricAssessment => Boolean(value));
  if (values.some((value) => value.critical)) return "critical_overdue";
  if (values.some((value) => value.overdue)) return "overdue";
  if (values.some((value) => value.due)) return "due";
  if (values.some((value) => value.eligible)) return "eligible";
  return "not_due";
}

function validateTaskDefinition(definition: MaintenanceTaskDefinition): void {
  assertTransportIdentifier(definition.code, "maintenanceTask.code");
  assertTransportIdentifier(definition.localizationKey, "maintenanceTask.localizationKey");
  if (!(definition.interval instanceof ServiceInterval)) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { taskCode: definition.code });
  }
  assertSafeInteger(definition.version, "maintenanceTask.version", "TRANSPORT_MAINTENANCE_TASK_INVALID", 1);
  assertSafeInteger(
    definition.overdueMultiplierBps,
    "overdueMultiplierBps",
    "TRANSPORT_MAINTENANCE_TASK_INVALID",
    10_000,
    1_000_000
  );
  assertSafeInteger(
    definition.criticalOverdueMultiplierBps,
    "criticalOverdueMultiplierBps",
    "TRANSPORT_MAINTENANCE_TASK_INVALID",
    definition.overdueMultiplierBps,
    1_000_000
  );
}

function validateThreshold(threshold: ServiceThreshold, field: string, requireOne: boolean, minimum: number): void {
  const values = [threshold.distanceMeters, threshold.timeMilliseconds, threshold.usageCount];
  if (requireOne && values.every((value) => value === undefined)) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { field });
  }
  for (const [index, value] of values.entries()) {
    if (value !== undefined) {
      assertSafeInteger(value, `${field}.${index}`, "TRANSPORT_MAINTENANCE_INTERVAL_INVALID", minimum);
    }
  }
}

function assertThresholdAligned(threshold: ServiceThreshold, interval: ServiceThreshold): void {
  for (const key of ["distanceMeters", "timeMilliseconds", "usageCount"] as const) {
    if (threshold[key] !== undefined && interval[key] === undefined) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { field: key });
    }
  }
}

function assertWindowWithinInterval(window: ServiceThreshold, interval: ServiceThreshold): void {
  for (const key of ["distanceMeters", "timeMilliseconds", "usageCount"] as const) {
    const windowValue = window[key];
    const intervalValue = interval[key];
    if (windowValue !== undefined && (intervalValue === undefined || windowValue >= intervalValue)) {
      throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_INTERVAL_INVALID", { field: key });
    }
  }
}

function validateMaintenanceContext(context: MaintenanceContext): void {
  timestampMilliseconds(context.at, "maintenance.at");
  assertSafeInteger(context.mileageMeters, "maintenance.mileageMeters", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
  assertSafeInteger(context.usageCount, "maintenance.usageCount", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
}

function validateCheckpoint(checkpoint: MaintenanceCheckpoint): void {
  assertTransportIdentifier(checkpoint.taskCode, "checkpoint.taskCode");
  timestampMilliseconds(checkpoint.servicedAt, "checkpoint.servicedAt");
  assertSafeInteger(checkpoint.mileageMeters, "checkpoint.mileageMeters", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
  assertSafeInteger(checkpoint.usageCount, "checkpoint.usageCount", "TRANSPORT_MAINTENANCE_SCHEDULE_INVALID");
}

function assertContextNotBeforeCheckpoint(context: MaintenanceContext, checkpoint: MaintenanceCheckpoint): void {
  if (context.mileageMeters < checkpoint.mileageMeters || context.usageCount < checkpoint.usageCount ||
    timestampMilliseconds(context.at, "context.at") < timestampMilliseconds(checkpoint.servicedAt, "checkpoint.servicedAt")) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { taskCode: checkpoint.taskCode });
  }
}

function normalizeTaskCodes(taskCodes: readonly string[]): readonly string[] {
  const normalized = taskCodes.map((code) => assertTransportIdentifier(code, "taskCode"));
  if (normalized.length === 0 || new Set(normalized).size !== normalized.length) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_TASK_INVALID", { field: "taskCodes" });
  }
  return Object.freeze([...normalized]);
}

function freezeCheckpoint(checkpoint: MaintenanceCheckpoint): MaintenanceCheckpoint {
  return Object.freeze({ ...checkpoint });
}

function freezeMaintenanceQuote(quote: MaintenanceQuote): MaintenanceQuote {
  return Object.freeze({
    ...quote,
    taskCodes: Object.freeze([...quote.taskCodes]),
    assessments: Object.freeze(quote.assessments.map((assessment) => Object.freeze({ ...assessment }))),
    cost: Object.freeze({ ...quote.cost })
  });
}

function safeMetricSum(left: number, right: number, field: string): number {
  const sum = BigInt(left) + BigInt(right);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw TransportErrorFactory.create("TRANSPORT_MAINTENANCE_SCHEDULE_INVALID", { field });
  }
  return Number(sum);
}
