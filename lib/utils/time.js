export function todayUTC() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : fallback;
}