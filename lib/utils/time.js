export function todayUTC() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

