import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';

/**
 * Périodes des rapports admin. Les horodatages de la base sont des
 * chaînes UTC « YYYY-MM-DD HH:MM:SS » (datetime('now') de SQLite) ;
 * les frontières de périodes sont calculées dans le fuseau configuré
 * (app_meta timezone) puis converties en UTC pour la comparaison SQL.
 */

export type PeriodPreset =
  | 'jour'
  | 'semaine'
  | 'mois'
  | 'trimestre'
  | 'annee'
  | 'personnalisee';

export interface PeriodRange {
  preset: PeriodPreset;
  /** Début inclutif (chaîne UTC SQLite). */
  from: string;
  /** Fin exclusive (chaîne UTC SQLite). */
  to: string;
  label: string;
}

const PRESETS: PeriodPreset[] = [
  'jour',
  'semaine',
  'mois',
  'trimestre',
  'annee',
  'personnalisee',
];

export function appTimezone(): string {
  const row = sessionsDb()
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('timezone') as { value: string } | undefined;
  return row?.value ?? 'Indian/Antananarivo';
}

/** Décalage (ms) du fuseau pour un instant UTC donné. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** Instant UTC (ms) du début de jour local demandé. */
function localDayStartUtc(year: number, month: number, day: number, tz: string): number {
  const naive = Date.UTC(year, month - 1, day);
  let offset = tzOffsetMs(naive, tz);
  let utc = naive - offset;
  const corrected = tzOffsetMs(utc, tz);
  if (corrected !== offset) {
    offset = corrected;
    utc = naive - offset;
  }
  return utc;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toSqlDate(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Aujourd'hui en jour local (Y/M/D) du fuseau configuré. */
export function todayLocal(tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

function parseDateInput(raw: unknown): { year: number; month: number; day: number } | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function isoDay(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Calcule la plage demandée + la période précédente comparable. */
export function resolvePeriod(params: URLSearchParams): {
  current: PeriodRange;
  previous: PeriodRange;
} {
  const tz = appTimezone();
  const presetRaw = params.get('period') ?? 'mois';
  if (!PRESETS.includes(presetRaw as PeriodPreset)) {
    throw new ServiceError('Période inconnue.', 400);
  }
  const preset = presetRaw as PeriodPreset;
  const today = todayLocal(tz);
  let start: { year: number; month: number; day: number };
  let endDay: { year: number; month: number; day: number };
  let label: string;
  if (preset === 'personnalisee') {
    const from = parseDateInput(params.get('from'));
    const to = parseDateInput(params.get('to'));
    if (!from || !to) {
      throw new ServiceError(
        'Dates de début et de fin requises (format AAAA-MM-JJ) pour une période personnalisée.',
        400,
      );
    }
    const fromMs = localDayStartUtc(from.year, from.month, from.day, tz);
    const toMs = localDayStartUtc(to.year, to.month, to.day, tz);
    if (toMs < fromMs) {
      throw new ServiceError('La date de fin précède la date de début.', 400);
    }
    return finalizeCustom(from, to, tz);
  }
  switch (preset) {
    case 'jour':
      start = today;
      endDay = today;
      label = `Journée ${isoDay(today)}`;
      break;
    case 'semaine': {
      const dow = localDow(today, tz);
      const startUtcMs = localDayStartUtc(today.year, today.month, today.day, tz) - dow * 86_400_000;
      const sd = new Date(startUtcMs);
      start = { year: sd.getUTCFullYear(), month: sd.getUTCMonth() + 1, day: sd.getUTCDate() };
      const endUtcMs = startUtcMs + 6 * 86_400_000;
      const ed = new Date(endUtcMs);
      endDay = { year: ed.getUTCFullYear(), month: ed.getUTCMonth() + 1, day: ed.getUTCDate() };
      label = `Semaine du ${isoDay(start)} au ${isoDay(endDay)}`;
      break;
    }
    case 'mois':
      start = { ...today, day: 1 };
      endDay = lastDayOfMonth(today.year, today.month);
      label = `Mois ${pad(today.month)}/${today.year}`;
      break;
    case 'trimestre':
      start = { ...today, day: 1, month: Math.floor((today.month - 1) / 3) * 3 + 1 };
      endDay = lastDayOfMonth(start.year, start.month + 2);
      label = `Trimestre T${Math.floor((today.month - 1) / 3) + 1} ${today.year}`;
      break;
    default:
      start = { ...today, day: 1, month: 1 };
      endDay = { year: today.year, month: 12, day: 31 };
      label = `Année ${today.year}`;
      break;
  }
  const current = buildRange(preset, start, endDay, label, tz);
  const previous = previousRange(current);
  return { current, previous };
}

function finalizeCustom(
  from: { year: number; month: number; day: number },
  to: { year: number; month: number; day: number },
  tz: string,
): { current: PeriodRange; previous: PeriodRange } {
  const fromMs = localDayStartUtc(from.year, from.month, from.day, tz);
  const toMs = localDayStartUtc(to.year, to.month, to.day, tz);
  const days = Math.round((toMs - fromMs) / 86_400_000) + 1;
  const prevToMs = fromMs - 86_400_000;
  const prevFromMs = prevToMs - (days - 1) * 86_400_000;
  const pf = new Date(prevFromMs);
  const pt = new Date(prevToMs);
  const prevFrom = {
    year: pf.getUTCFullYear(),
    month: pf.getUTCMonth() + 1,
    day: pf.getUTCDate(),
  };
  const prevTo = {
    year: pt.getUTCFullYear(),
    month: pt.getUTCMonth() + 1,
    day: pt.getUTCDate(),
  };
  return {
    current: {
      preset: 'personnalisee',
      from: toSqlDate(fromMs),
      to: toSqlDate(toMs + 86_400_000),
      label: `Du ${isoDay(from)} au ${isoDay(to)} (${days} j)`,
    },
    previous: {
      preset: 'personnalisee',
      from: toSqlDate(prevFromMs),
      to: toSqlDate(prevToMs + 86_400_000),
      label: `Du ${isoDay(prevFrom)} au ${isoDay(prevTo)} (${days} j)`,
    },
  };
}

function localDow(date: { year: number; month: number; day: number }, tz: string): number {
  const ms = localDayStartUtc(date.year, date.month, date.day, tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const name = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[name] ?? 0;
}

function lastDayOfMonth(year: number, month: number): { year: number; month: number; day: number } {
  const normalizedMonth = ((month - 1) % 12) + 1;
  const yearOffset = Math.floor((month - 1) / 12);
  const last = new Date(Date.UTC(year + yearOffset, normalizedMonth, 0));
  return {
    year: last.getUTCFullYear(),
    month: last.getUTCMonth() + 1,
    day: last.getUTCDate(),
  };
}

function buildRange(
  preset: PeriodPreset,
  start: { year: number; month: number; day: number },
  end: { year: number; month: number; day: number },
  label: string,
  tz: string,
): PeriodRange {
  const fromMs = localDayStartUtc(start.year, start.month, start.day, tz);
  const toMs = localDayStartUtc(end.year, end.month, end.day, tz) + 86_400_000;
  return { preset, from: toSqlDate(fromMs), to: toSqlDate(toMs), label };
}

/** Période précédente de même durée, comparaison équitable. */
function previousRange(current: PeriodRange): PeriodRange {
  const fromMs = Date.parse(`${current.from.replace(' ', 'T')}Z`);
  const toMs = Date.parse(`${current.to.replace(' ', 'T')}Z`);
  const days = Math.max(1, Math.round((toMs - fromMs) / 86_400_000));
  const prevToMs = fromMs - 1;
  const prevFromMs = prevToMs - days * 86_400_000 + 86_400_000;
  const pf = new Date(prevFromMs);
  const pt = new Date(prevToMs);
  const prevFrom = {
    year: pf.getUTCFullYear(),
    month: pf.getUTCMonth() + 1,
    day: pf.getUTCDate(),
  };
  const prevTo = {
    year: pt.getUTCFullYear(),
    month: pt.getUTCMonth() + 1,
    day: pt.getUTCDate(),
  };
  return {
    preset: 'personnalisee',
    from: toSqlDate(prevFromMs),
    to: toSqlDate(prevToMs + 86_400_000),
    label: `Période précédente (${isoDay(prevFrom)} → ${isoDay(prevTo)})`,
  };
}

export function describeRange(range: PeriodRange, tz: string): string {
  void tz;
  return `${range.from.slice(0, 16)} → ${range.to.slice(0, 16)}`;
}
