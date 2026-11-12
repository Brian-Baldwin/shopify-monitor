const BUSINESS_DAYS = [1, 2, 3, 4, 5]; // Mon-Fri
const BUSINESS_START_HOUR = 9; // 9am ET
const BUSINESS_END_HOUR = 21; // 9pm ET
export const OFF_HOURS_MULTIPLIER = 4;

/**
 * Returns true if `date` falls on a weekday between 9am-9pm Eastern Time
 * (handles EST/EDT automatically via the America/New_York timezone).
 */
export function isBusinessHours(date: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  let hour = 0;
  let weekday = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    if (part.type === 'weekday') weekday = weekdayMap[part.value] ?? 0;
  }

  return BUSINESS_DAYS.includes(weekday) && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
}

/**
 * Returns the check interval in minutes for the current time: the base
 * interval during Mon-Fri 9am-9pm ET, and OFF_HOURS_MULTIPLIER x that
 * interval outside of that window.
 */
export function getIntervalMinutes(baseIntervalMinutes: number, date: Date = new Date()): number {
  return isBusinessHours(date) ? baseIntervalMinutes : baseIntervalMinutes * OFF_HOURS_MULTIPLIER;
}

/** Returns `date`'s calendar date in Eastern Time, as YYYY-MM-DD. */
export function getEasternDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') lookup[part.type] = part.value;
  }

  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

/**
 * Returns milliseconds until the next occurrence of `targetHour:00` Eastern
 * Time on a weekday (Mon-Fri). If today is a weekday and the target time has
 * not yet passed, it fires today; otherwise advances to the next weekday.
 */
export function getMsUntilNextWeekdayEasternTime(targetHour: number, date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  let hour = 0, minute = 0, second = 0, weekday = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'second') second = parseInt(part.value, 10);
    if (part.type === 'weekday') weekday = weekdayMap[part.value] ?? 0;
  }

  const msSinceMidnight = (hour * 3600 + minute * 60 + second) * 1000 + date.getMilliseconds();
  const targetMs = targetHour * 3600 * 1000;
  const isWeekday = weekday >= 1 && weekday <= 5;

  let daysAhead = 0;
  if (!isWeekday || msSinceMidnight >= targetMs) {
    daysAhead = 1;
    while (true) {
      if (((weekday + daysAhead) % 7) >= 1 && ((weekday + daysAhead) % 7) <= 5) break;
      daysAhead++;
    }
  }

  if (daysAhead === 0) {
    return targetMs - msSinceMidnight;
  }
  const msUntilMidnight = 24 * 3600 * 1000 - msSinceMidnight;
  return msUntilMidnight + (daysAhead - 1) * 24 * 3600 * 1000 + targetMs;
}

/**
 * Returns milliseconds until the next 00:00:00 Eastern Time. Computed from
 * the current ET wall-clock time rather than a fixed 24h offset, so it
 * self-corrects across DST transitions.
 */
export function getMsUntilNextEasternMidnight(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);

  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10) % 24;
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'second') second = parseInt(part.value, 10);
  }

  const msSinceMidnight = (hour * 3600 + minute * 60 + second) * 1000 + date.getMilliseconds();
  return 24 * 60 * 60 * 1000 - msSinceMidnight;
}
