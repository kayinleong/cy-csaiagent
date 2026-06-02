/**
 * src/jobs/workingHours.ts — Working-hours predicate for escalation delivery
 *
 * `isWithinWorkingHours` gates escalation delivery to business hours in
 * Asia/Kuala_Lumpur (UTC+8, no DST). This prevents stall alerts from surfacing
 * to senior coaches outside their working day (CDASH-06).
 *
 * DEFAULT WINDOW (Assumption A1 — confirm with Derek before pilot):
 *   Timezone : Asia/Kuala_Lumpur (UTC+8, no DST)
 *   Days     : Monday–Friday
 *   Hours    : 09:00–18:00 (local KL time)
 *
 * Derek must confirm:
 *   - Exact daily window (e.g., 09:00–17:30?)
 *   - Whether public holidays are excluded (not implemented in v1 — simple Mon–Fri)
 *   - Whether nudges and escalations use the same window or different windows
 *
 * The function uses `Intl.DateTimeFormat` (built into V8/Node, no extra deps)
 * because date-fns@4 does not include a timezone module (date-fns-tz was not
 * installed). This avoids adding a new dependency and is fully testable with
 * injectable clocks.
 *
 * References:
 *   - 02-CONTEXT.md D-08/D-09 (working-hours gate for escalation delivery)
 *   - 02-RESEARCH.md Assumption A1 + Pattern 4 (job bodies)
 *   - CDASH-06 (escalation alerts within working hours)
 *   - T-02-22 (heartbeat watchdog + working-hours deferral)
 *
 * Export: isWithinWorkingHours(now, opts?)
 */

/** Options for customizing the working-hours window. */
export interface WorkingHoursOpts {
  /** IANA timezone string. Default: 'Asia/Kuala_Lumpur'. */
  tz?: string
  /**
   * First hour of the working day (inclusive, 24-h clock, local time).
   * Default: 9 (09:00 KL time).
   */
  startHour?: number
  /**
   * Last hour of the working day (exclusive, 24-h clock, local time).
   * Default: 18 (18:00 KL time — i.e., alerts up to 17:59 are allowed).
   */
  endHour?: number
}

/**
 * Returns true if `now` falls within the configured working-hours window.
 *
 * Working hours = Mon–Fri, 09:00–18:00 in Asia/Kuala_Lumpur by default.
 *
 * The check is intentionally simple for v1 — public holidays are NOT excluded.
 * Derek should confirm the exact window before the pilot goes live.
 *
 * @param now       The point in time to check (injectable clock for tests).
 * @param opts      Optional overrides for tz / startHour / endHour.
 * @returns         `true` if within working hours, `false` otherwise.
 */
export function isWithinWorkingHours(now: Date, opts?: WorkingHoursOpts): boolean {
  const tz = opts?.tz ?? 'Asia/Kuala_Lumpur'
  const startHour = opts?.startHour ?? 9
  const endHour = opts?.endHour ?? 18

  // Use Intl.DateTimeFormat to extract local weekday + hour in the target timezone.
  // This avoids a date-fns-tz dependency and is accurate for non-DST zones like KL.
  const fmt = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    weekday: 'short', // 'Mon', 'Tue', ..., 'Sun'
    hour: 'numeric',
    hour12: false,
  })

  const parts = fmt.formatToParts(now)

  const weekdayPart = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0'

  // hour24 can be '24' for midnight in some locales — normalise
  let hour = parseInt(hourStr, 10)
  if (hour === 24) hour = 0

  // Mon–Fri only
  const isWeekday = !['Sat', 'Sun'].includes(weekdayPart)

  // 09:00 (inclusive) up to 18:00 (exclusive)
  const isWithinHours = hour >= startHour && hour < endHour

  return isWeekday && isWithinHours
}
