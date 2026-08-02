"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Mileage = void 0;
const transport_domain_validation_1 = require("./transport-domain-validation");
const transport_errors_1 = require("./transport-errors");
class Mileage {
    meters;
    constructor(meters) {
        this.meters = meters;
        Object.freeze(this);
    }
    static zero() {
        return new Mileage(0);
    }
    static fromMeters(meters) {
        (0, transport_domain_validation_1.assertSafeInteger)(meters, "meters", "TRANSPORT_MILEAGE_INVALID");
        return new Mileage(meters);
    }
    static restore(snapshot) {
        return Mileage.fromMeters(snapshot.meters);
    }
    get kilometers() {
        return this.meters / 1_000;
    }
    advance(distanceMeters) {
        (0, transport_domain_validation_1.assertSafeInteger)(distanceMeters, "distanceMeters", "TRANSPORT_MILEAGE_INVALID");
        const next = (0, transport_domain_validation_1.safeIntegerFromBigInt)(BigInt(this.meters) + BigInt(distanceMeters), "TRANSPORT_MILEAGE_OVERFLOW", "meters");
        return new Mileage(next);
    }
    update(nextMeters) {
        (0, transport_domain_validation_1.assertSafeInteger)(nextMeters, "nextMeters", "TRANSPORT_MILEAGE_INVALID");
        if (nextMeters < this.meters) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_MILEAGE_DECREASE", {
                currentMeters: this.meters,
                nextMeters
            });
        }
        return new Mileage(nextMeters);
    }
    serialize() {
        return Object.freeze({ meters: this.meters });
    }
}
exports.Mileage = Mileage;
