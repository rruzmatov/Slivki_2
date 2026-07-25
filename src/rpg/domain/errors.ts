export class DomainError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
  }
}

export const invariant = (condition: boolean, message: string, code = "DOMAIN_INVARIANT"): void => {
  if (!condition) {
    throw new DomainError(message, code);
  }
};
