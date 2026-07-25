export const nowIso = (): string => new Date().toISOString();

export const sameTashkentDay = (left?: string, right = nowIso()): boolean => {
  if (!left) {
    return false;
  }

  const format = (value: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(value));

  return format(left) === format(right);
};

export const secondsSince = (iso?: string): number => {
  if (!iso) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
};
