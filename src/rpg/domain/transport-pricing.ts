import {
  assertSafeInteger,
  assertTransportIdentifier,
  safeIntegerFromBigInt
} from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";

export type PolicyVersion = string;

export interface PricingContext {
  readonly currency: string;
  readonly baseAmount: number;
  readonly rarityFactorBps: number;
  readonly ageFactorBps: number;
  readonly assetTypeFactorBps: number;
  readonly categoryFactorBps: number;
  readonly economicBalanceFactorBps: number;
}

export interface PricingAdjustment {
  readonly code: string;
  readonly factorBps: number;
  readonly amountBefore: number;
  readonly amountAfter: number;
  readonly deltaAmount: number;
}

export interface PricingBreakdown {
  readonly currency: string;
  readonly baseAmount: number;
  readonly adjustments: readonly PricingAdjustment[];
  readonly totalAmount: number;
  readonly policyVersion: PolicyVersion;
}

export interface RepairPricingContext extends PricingContext {
  readonly maximumHealth: number;
  readonly missingHealthUnits: number;
  readonly restoreHealthUnits: number;
}

export interface MaintenancePricingContext extends PricingContext {
  readonly taskCount: number;
  readonly overdueMultiplierBps: number;
}

export interface ResalePricingContext extends PricingContext {
  readonly conditionFactorBps: number;
  readonly mileageFactorBps: number;
}

export interface RepairPricingPolicy {
  readonly version: PolicyVersion;
  quote(context: RepairPricingContext): PricingBreakdown;
}

export interface MaintenancePricingPolicy {
  readonly version: PolicyVersion;
  quote(context: MaintenancePricingContext): PricingBreakdown;
}

export interface ResaleValuationPolicy {
  readonly version: PolicyVersion;
  valuate(context: ResalePricingContext): PricingBreakdown;
}

export class RateBasedRepairPricingPolicy implements RepairPricingPolicy {
  readonly version: PolicyVersion;

  constructor(version: string, private readonly minimumAmount = 0) {
    this.version = validatePolicyVersion(version);
    assertSafeInteger(minimumAmount, "minimumAmount", "TRANSPORT_PRICING_CONTEXT_INVALID");
  }

  quote(context: RepairPricingContext): PricingBreakdown {
    validatePricingContext(context);
    assertSafeInteger(context.maximumHealth, "maximumHealth", "TRANSPORT_PRICING_CONTEXT_INVALID", 1);
    assertSafeInteger(
      context.missingHealthUnits,
      "missingHealthUnits",
      "TRANSPORT_PRICING_CONTEXT_INVALID",
      1,
      context.maximumHealth
    );
    assertSafeInteger(
      context.restoreHealthUnits,
      "restoreHealthUnits",
      "TRANSPORT_PRICING_CONTEXT_INVALID",
      1,
      context.missingHealthUnits
    );
    const proportionalAmount = Math.max(
      this.minimumAmount,
      ratioAmount(context.baseAmount, context.restoreHealthUnits, context.maximumHealth)
    );
    return buildPricingBreakdown(proportionalAmount, context, this.version);
  }
}

export class RateBasedMaintenancePricingPolicy implements MaintenancePricingPolicy {
  readonly version: PolicyVersion;

  constructor(version: string) {
    this.version = validatePolicyVersion(version);
  }

  quote(context: MaintenancePricingContext): PricingBreakdown {
    validatePricingContext(context);
    assertSafeInteger(context.taskCount, "taskCount", "TRANSPORT_PRICING_CONTEXT_INVALID", 1, 1_000);
    assertFactor(context.overdueMultiplierBps, "overdueMultiplierBps");
    const tasksAmount = safeIntegerFromBigInt(
      BigInt(context.baseAmount) * BigInt(context.taskCount),
      "TRANSPORT_PRICING_OVERFLOW",
      "maintenanceBaseAmount"
    );
    return buildPricingBreakdown(tasksAmount, context, this.version, [
      { code: "overdue", factorBps: context.overdueMultiplierBps }
    ]);
  }
}

export class RateBasedResaleValuationPolicy implements ResaleValuationPolicy {
  readonly version: PolicyVersion;

  constructor(version: string) {
    this.version = validatePolicyVersion(version);
  }

  valuate(context: ResalePricingContext): PricingBreakdown {
    validatePricingContext(context);
    assertFactor(context.conditionFactorBps, "conditionFactorBps");
    assertFactor(context.mileageFactorBps, "mileageFactorBps");
    return buildPricingBreakdown(context.baseAmount, context, this.version, [
      { code: "condition", factorBps: context.conditionFactorBps },
      { code: "mileage", factorBps: context.mileageFactorBps }
    ]);
  }
}

export function validatePolicyVersion(version: string): PolicyVersion {
  if (!/^[1-9][0-9]*\.[0-9]+(?:\.[0-9]+)?(?:-[a-z0-9.-]+)?$/.test(version)) {
    throw TransportErrorFactory.create("TRANSPORT_POLICY_VERSION_INVALID", { version });
  }
  return version;
}

export function validatePricingBreakdown(breakdown: PricingBreakdown, expectedVersion: PolicyVersion): void {
  validatePolicyVersion(breakdown.policyVersion);
  if (breakdown.policyVersion !== expectedVersion) {
    throw TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", {
      expectedVersion,
      actualVersion: breakdown.policyVersion
    });
  }
  assertTransportIdentifier(breakdown.currency, "currency");
  assertSafeInteger(breakdown.baseAmount, "baseAmount", "TRANSPORT_PRICING_BREAKDOWN_INVALID");
  assertSafeInteger(breakdown.totalAmount, "totalAmount", "TRANSPORT_PRICING_BREAKDOWN_INVALID");
  let amount = breakdown.baseAmount;
  for (const adjustment of breakdown.adjustments) {
    assertTransportIdentifier(adjustment.code, "adjustment.code");
    assertFactor(adjustment.factorBps, "adjustment.factorBps");
    if (adjustment.amountBefore !== amount || adjustment.amountAfter - adjustment.amountBefore !== adjustment.deltaAmount) {
      throw TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", { code: adjustment.code });
    }
    amount = applyFactor(amount, adjustment.factorBps);
    if (adjustment.amountAfter !== amount) {
      throw TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", { code: adjustment.code });
    }
  }
  if (amount !== breakdown.totalAmount) {
    throw TransportErrorFactory.create("TRANSPORT_PRICING_BREAKDOWN_INVALID", { totalAmount: breakdown.totalAmount });
  }
}

function buildPricingBreakdown(
  baseAmount: number,
  context: PricingContext,
  policyVersion: PolicyVersion,
  additionalFactors: readonly { code: string; factorBps: number }[] = []
): PricingBreakdown {
  const factors = [
    { code: "rarity", factorBps: context.rarityFactorBps },
    { code: "age", factorBps: context.ageFactorBps },
    { code: "asset_type", factorBps: context.assetTypeFactorBps },
    { code: "category", factorBps: context.categoryFactorBps },
    { code: "economic_balance", factorBps: context.economicBalanceFactorBps },
    ...additionalFactors
  ];
  const adjustments: PricingAdjustment[] = [];
  let amount = baseAmount;
  for (const factor of factors) {
    assertFactor(factor.factorBps, factor.code);
    const amountAfter = applyFactor(amount, factor.factorBps);
    adjustments.push(Object.freeze({
      code: factor.code,
      factorBps: factor.factorBps,
      amountBefore: amount,
      amountAfter,
      deltaAmount: amountAfter - amount
    }));
    amount = amountAfter;
  }
  const breakdown = Object.freeze({
    currency: context.currency,
    baseAmount,
    adjustments: Object.freeze(adjustments),
    totalAmount: amount,
    policyVersion
  });
  validatePricingBreakdown(breakdown, policyVersion);
  return breakdown;
}

function validatePricingContext(context: PricingContext): void {
  assertTransportIdentifier(context.currency, "currency");
  assertSafeInteger(context.baseAmount, "baseAmount", "TRANSPORT_PRICING_CONTEXT_INVALID");
  assertFactor(context.rarityFactorBps, "rarityFactorBps");
  assertFactor(context.ageFactorBps, "ageFactorBps");
  assertFactor(context.assetTypeFactorBps, "assetTypeFactorBps");
  assertFactor(context.categoryFactorBps, "categoryFactorBps");
  assertFactor(context.economicBalanceFactorBps, "economicBalanceFactorBps");
}

function assertFactor(value: number, field: string): void {
  assertSafeInteger(value, field, "TRANSPORT_PRICING_CONTEXT_INVALID", 0, 1_000_000);
}

function ratioAmount(amount: number, numerator: number, denominator: number): number {
  const value = BigInt(amount) * BigInt(numerator);
  return safeIntegerFromBigInt(
    (value + BigInt(denominator) - 1n) / BigInt(denominator),
    "TRANSPORT_PRICING_OVERFLOW",
    "ratioAmount"
  );
}

function applyFactor(amount: number, factorBps: number): number {
  const value = BigInt(amount) * BigInt(factorBps);
  return safeIntegerFromBigInt((value + 5_000n) / 10_000n, "TRANSPORT_PRICING_OVERFLOW", "adjustedAmount");
}
