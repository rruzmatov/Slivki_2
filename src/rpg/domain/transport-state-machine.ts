import { TransportErrorFactory } from "./transport-errors";

export type VehicleOperationalState =
  | "available"
  | "in_use"
  | "under_maintenance"
  | "under_repair"
  | "out_of_service"
  | "retired";

const transitions: Readonly<Record<VehicleOperationalState, readonly VehicleOperationalState[]>> = {
  available: ["in_use", "under_maintenance", "under_repair", "out_of_service"],
  in_use: ["available", "out_of_service"],
  under_maintenance: ["available"],
  under_repair: ["available"],
  out_of_service: ["retired"],
  retired: []
};

export class VehicleStateMachine {
  canTransition(from: VehicleOperationalState, to: VehicleOperationalState): boolean {
    return transitions[from].includes(to);
  }

  transition(from: VehicleOperationalState, to: VehicleOperationalState): VehicleOperationalState {
    if (!this.canTransition(from, to)) {
      throw TransportErrorFactory.create("TRANSPORT_STATE_TRANSITION_FORBIDDEN", { from, to });
    }
    return to;
  }
}
