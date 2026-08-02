"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StructuredLogger = void 0;
class StructuredLogger {
    sink;
    constructor(sink = console.log) {
        this.sink = sink;
    }
    write(record) {
        this.sink(JSON.stringify(record));
    }
}
exports.StructuredLogger = StructuredLogger;
