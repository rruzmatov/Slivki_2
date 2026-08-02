"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VehicleStateMachine = void 0;
const transport_errors_1 = require("./transport-errors");
const transitions = {
    available: ["in_use", "under_maintenance", "under_repair", "out_of_service"],
    in_use: ["available", "out_of_service"],
    under_maintenance: ["available"],
    under_repair: ["available"],
    out_of_service: ["retired"],
    retired: []
};
class VehicleStateMachine {
    canTransition(from, to) {
        return transitions[from].includes(to);
    }
    transition(from, to) {
        if (!this.canTransition(from, to)) {
            throw transport_errors_1.TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", { from, to });
        }
        return to;
    }
}
exports.VehicleStateMachine = VehicleStateMachine;
