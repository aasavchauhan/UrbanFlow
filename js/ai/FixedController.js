/**
 * FixedController — Baseline fixed-timing signal controller.
 * Used for benchmark comparison against AIController.
 */
export class FixedController {
    constructor() {
        // Fixed controllers don't adapt — they just let signals run their default timers
    }

    /**
     * No-op update — fixed signals run on their own timers.
     */
    update(dt, signals, vehicleManager) {
        // Fixed controller does nothing — signals cycle at fixed intervals
        // This is intentional: it serves as the baseline "dumb" controller
    }
}
