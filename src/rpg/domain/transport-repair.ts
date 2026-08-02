import { StructuralCondition, type StructuralConditionSnapshot } from "./transport-condition";
import {
  assertNonEmptyReason,
  assertSafeInteger,
  assertTransportIdentifier,
  timestampMilliseconds
} from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";
import {
  type PricingBreakdown,
  type RepairPricingContext,
  type RepairPricingPolicy,
  validatePricingBreakdown
} from "./transport-pricing";

export interface RepairRequirements {
  readonly permission: "repair";
  readonly requiresReason: true;
  readonly minimumMissingHealthUnits: number;
}

export interface RepairCost {
  readonly amount: number;
  readonly currency: string;
  readonly breakdown: PricingBreakdown;
}

export interface RepairQuote {
  readonly quoteId: string;
  readonly vehicleId: string;
  readonly reasonCode: string;
  readonly conditionAtQuote: StructuralConditionSnapshot;
  readonly restoreHealthUnits: number;
  readonly cost: RepairCost;
  readonly policyVersion: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface CreateRepairQuoteInput {
  readonly quoteId: string;
  readonly vehicleId: string;
  readonly reasonCode: string;
  readonly condition: StructuralCondition;
  readonly restoreHealthUnits?: number;
  readonly pricingContext: Omit<RepairPricingContext, "maximumHealth" | "missingHealthUnits" | "restoreHealthUnits">;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface RepairResult {
  readonly quoteId: string;
  readonly vehicleId: string;
  readonly before: StructuralConditionSnapshot;
  readonly after: StructuralConditionSnapshot;
  readonly restoredHealthUnits: number;
  readonly cost: RepairCost;
  readonly completedAt: string;
}

export class RepairPolicy {
  readonly requirements: RepairRequirements = Object.freeze({
    permission: "repair",
    requiresReason: true,
    minimumMissingHealthUnits: 1
  });

  constructor(private readonly pricing: RepairPricingPolicy) {}

  createQuote(input: CreateRepairQuoteInput): RepairQuote {
    assertTransportIdentifier(input.quoteId, "quoteId");
    assertTransportIdentifier(input.vehicleId, "vehicleId");
    const reasonCode = assertNonEmptyReason(input.reasonCode, "TRANSPORT_REPAIR_REASON_REQUIRED");
    if (input.condition.missingHealth < this.requirements.minimumMissingHealthUnits) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_NOT_REQUIRED", { vehicleId: input.vehicleId });
    }
    const restoreHealthUnits = input.restoreHealthUnits ?? input.condition.missingHealth;
    assertSafeInteger(
      restoreHealthUnits,
      "restoreHealthUnits",
      "TRANSPORT_REPAIR_QUOTE_INVALID",
      this.requirements.minimumMissingHealthUnits,
      input.condition.missingHealth
    );
    const createdAtMs = timestampMilliseconds(input.createdAt, "createdAt");
    const expiresAtMs = timestampMilliseconds(input.expiresAt, "expiresAt");
    if (expiresAtMs <= createdAtMs) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { field: "expiresAt" });
    }
    const breakdown = this.pricing.quote({
      ...input.pricingContext,
      maximumHealth: input.condition.maximumHealth,
      missingHealthUnits: input.condition.missingHealth,
      restoreHealthUnits
    });
    validatePricingBreakdown(breakdown, this.pricing.version);
    return freezeRepairQuote({
      quoteId: input.quoteId,
      vehicleId: input.vehicleId,
      reasonCode,
      conditionAtQuote: input.condition.snapshot(),
      restoreHealthUnits,
      cost: {
        amount: breakdown.totalAmount,
        currency: breakdown.currency,
        breakdown
      },
      policyVersion: this.pricing.version,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt
    });
  }

  complete(condition: StructuralCondition, quote: RepairQuote, completedAt: string): RepairResult {
    validateRepairQuote(quote);
    if (quote.policyVersion !== this.pricing.version) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    const completionMs = timestampMilliseconds(completedAt, "completedAt");
    if (completionMs < timestampMilliseconds(quote.createdAt, "createdAt") ||
      completionMs > timestampMilliseconds(quote.expiresAt, "expiresAt")) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
    }
    if (!sameCondition(condition.snapshot(), quote.conditionAtQuote)) {
      throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", {
        quoteId: quote.quoteId,
        field: "conditionAtQuote"
      });
    }
    const after = condition.restoreHealth(quote.restoreHealthUnits);
    return Object.freeze({
      quoteId: quote.quoteId,
      vehicleId: quote.vehicleId,
      before: condition.snapshot(),
      after: after.snapshot(),
      restoredHealthUnits: quote.restoreHealthUnits,
      cost: quote.cost,
      completedAt
    });
  }
}

export function validateRepairQuote(quote: RepairQuote): void {
  assertTransportIdentifier(quote.quoteId, "quoteId");
  assertTransportIdentifier(quote.vehicleId, "vehicleId");
  assertNonEmptyReason(quote.reasonCode, "TRANSPORT_REPAIR_REASON_REQUIRED");
  StructuralCondition.restore(quote.conditionAtQuote);
  assertSafeInteger(
    quote.restoreHealthUnits,
    "restoreHealthUnits",
    "TRANSPORT_REPAIR_QUOTE_INVALID",
    1,
    quote.conditionAtQuote.maximumHealth - quote.conditionAtQuote.currentHealth
  );
  const createdAtMs = timestampMilliseconds(quote.createdAt, "createdAt");
  const expiresAtMs = timestampMilliseconds(quote.expiresAt, "expiresAt");
  if (expiresAtMs <= createdAtMs) {
    throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
  }
  validatePricingBreakdown(quote.cost.breakdown, quote.policyVersion);
  if (quote.cost.amount !== quote.cost.breakdown.totalAmount || quote.cost.currency !== quote.cost.breakdown.currency) {
    throw TransportErrorFactory.create("TRANSPORT_REPAIR_QUOTE_INVALID", { quoteId: quote.quoteId });
  }
}

function sameCondition(left: StructuralConditionSnapshot, right: StructuralConditionSnapshot): boolean {
  return left.maximumHealth === right.maximumHealth &&
    left.currentHealth === right.currentHealth &&
    left.accumulatedWear === right.accumulatedWear;
}

function freezeRepairQuote(quote: RepairQuote): RepairQuote {
  return Object.freeze({
    ...quote,
    conditionAtQuote: Object.freeze({ ...quote.conditionAtQuote }),
    cost: Object.freeze({ ...quote.cost })
  });
}
