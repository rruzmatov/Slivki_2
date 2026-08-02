import { assertSafeInteger, safeIntegerFromBigInt } from "./transport-domain-validation";
import { TransportErrorFactory } from "./transport-errors";

export interface MileageSnapshot {
  readonly meters: number;
}

export class Mileage {
  private constructor(readonly meters: number) {
    Object.freeze(this);
  }

  static zero(): Mileage {
    return new Mileage(0);
  }

  static fromMeters(meters: number): Mileage {
    assertSafeInteger(meters, "meters", "TRANSPORT_MILEAGE_INVALID");
    return new Mileage(meters);
  }

  static restore(snapshot: MileageSnapshot): Mileage {
    return Mileage.fromMeters(snapshot.meters);
  }

  get kilometers(): number {
    return this.meters / 1_000;
  }

  advance(distanceMeters: number): Mileage {
    assertSafeInteger(distanceMeters, "distanceMeters", "TRANSPORT_MILEAGE_INVALID");
    const next = safeIntegerFromBigInt(
      BigInt(this.meters) + BigInt(distanceMeters),
      "TRANSPORT_MILEAGE_OVERFLOW",
      "meters"
    );
    return new Mileage(next);
  }

  update(nextMeters: number): Mileage {
    assertSafeInteger(nextMeters, "nextMeters", "TRANSPORT_MILEAGE_INVALID");
    if (nextMeters < this.meters) {
      throw TransportErrorFactory.create("TRANSPORT_MILEAGE_DECREASE", {
        currentMeters: this.meters,
        nextMeters
      });
    }
    return new Mileage(nextMeters);
  }

  serialize(): MileageSnapshot {
    return Object.freeze({ meters: this.meters });
  }
}
