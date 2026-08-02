export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly options: {
      localizationKey?: string;
      details?: Readonly<Record<string, string | number | boolean>>;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
  }
}

export const invariant = (condition: boolean, message: string, code = "DOMAIN_INVARIANT"): void => {
  if (!condition) {
    throw new DomainError(message, code);
  }
};
