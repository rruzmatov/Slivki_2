"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequirementEvaluator = void 0;
const errors_1 = require("../domain/errors");
class RequirementEvaluator {
    inventory;
    unlocks;
    handlers = new Map();
    constructor(inventory, unlocks) {
        this.inventory = inventory;
        this.unlocks = unlocks;
        this.registerBuiltIns();
    }
    registerPredicate(kind, handler) {
        if (!kind.trim() || this.handlers.has(kind))
            throw new errors_1.DomainError(`Requirement predicate уже зарегистрирован: ${kind}`, "REQUIREMENT_HANDLER_DUPLICATE");
        this.handlers.set(kind, handler);
    }
    async evaluate(context, expression) {
        if (!expression)
            return { passed: true, failures: [] };
        let visited = 0;
        const visit = async (rule, depth) => {
            visited += 1;
            if (visited > 256 || depth > 32)
                throw new errors_1.DomainError("Слишком сложное правило требований", "REQUIREMENT_COMPLEXITY_LIMIT");
            if (rule.operator === "predicate") {
                const handler = this.handlers.get(rule.predicate.kind);
                if (!handler)
                    throw new errors_1.DomainError(`Неизвестный тип требования: ${rule.predicate.kind}`, "REQUIREMENT_HANDLER_NOT_FOUND");
                const passed = await handler(context, rule.predicate);
                return { passed, failures: passed ? [] : [rule.predicate.message] };
            }
            if (rule.operator === "not") {
                const result = await visit(rule.rule, depth + 1);
                return result.passed ? { passed: false, failures: ["Запрещающее условие выполнено"] } : { passed: true, failures: [] };
            }
            if (rule.operator === "and") {
                const results = await Promise.all(rule.rules.map((child) => visit(child, depth + 1)));
                return { passed: results.every((result) => result.passed), failures: unique(results.flatMap((result) => result.failures)) };
            }
            const results = await Promise.all(rule.rules.map((child) => visit(child, depth + 1)));
            if (results.some((result) => result.passed))
                return { passed: true, failures: [] };
            return { passed: false, failures: unique(results.flatMap((result) => result.failures)) };
        };
        return visit(expression, 0);
    }
    async assert(context, expression) {
        const result = await this.evaluate(context, expression);
        if (!result.passed)
            throw new errors_1.DomainError(`Не выполнены требования: ${result.failures.join(", ")}`, "SHOP_REQUIREMENT_FAILED");
    }
    registerBuiltIns() {
        this.registerPredicate("player.level.at_least", async (context, rule) => context.player.level >= numberParam(rule, "value"));
        this.registerPredicate("player.balance.at_least", async (context, rule) => context.player.balance >= numberParam(rule, "value"));
        this.registerPredicate("family.level.at_least", async (context, rule) => (context.family?.level ?? 0) >= numberParam(rule, "value"));
        this.registerPredicate("inventory.owns_product", (context, rule) => this.inventory.hasProduct(context.owner ?? playerOwner(context), stringParam(rule, "productId")));
        this.registerPredicate("inventory.owns_category", (context, rule) => this.inventory.hasCategory(context.owner ?? playerOwner(context), stringParam(rule, "categoryId")));
        this.registerPredicate("inventory.owns_asset_type", (context, rule) => this.inventory.hasAssetType(context.owner ?? playerOwner(context), stringParam(rule, "assetTypeId")));
        this.registerPredicate("unlock.active", (context, rule) => this.unlocks.isUnlocked(context.owner ?? playerOwner(context), stringParam(rule, "type"), stringParam(rule, "targetId")));
        this.registerPredicate("achievement.owned", async (context, rule) => context.player.achievements.includes(stringParam(rule, "achievementId")));
        this.registerPredicate("player.country.equals", async (context, rule) => context.player.country === stringParam(rule, "country"));
    }
}
exports.RequirementEvaluator = RequirementEvaluator;
const playerOwner = (context) => ({ kind: "player", id: context.player.id });
function numberParam(rule, name) {
    const value = rule.params[name];
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new errors_1.DomainError(`Некорректный параметр ${name}`, "REQUIREMENT_PARAMETER_INVALID");
    return value;
}
function stringParam(rule, name) {
    const value = rule.params[name];
    if (typeof value !== "string" || !value)
        throw new errors_1.DomainError(`Некорректный параметр ${name}`, "REQUIREMENT_PARAMETER_INVALID");
    return value;
}
const unique = (values) => [...new Set(values)];
