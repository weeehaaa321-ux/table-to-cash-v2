/**
 * Minimal iCalendar parser tuned for OTA reservation feeds (Booking.com,
 * Airbnb, Vrbo). Pure-text, no dependencies. Handles only what we need:
 *   - line folding (RFC 5545 §3.1: lines > 75 chars are wrapped with a
 *     leading space or tab on the next line)
 *   - VEVENT blocks and their VALARM children we ignore
 *   - DTSTART / DTEND in either YYYYMMDD or YYYYMMDDTHHMMSSZ form
 *   - UID, SUMMARY, STATUS, DESCRIPTION
 *
 * Doesn't validate VCALENDAR wrapping, doesn't handle TZIDs (we treat
 * everything as UTC date-only — fine for nightly bookings since OTAs
 * always emit DATE values). Doesn't handle recurrence rules — none of
 * the supported OTAs use them for individual stays.
 */

export type ParsedEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  status: string | null;
};

function unfold(text: string): string[] {
  // Per RFC 5545: a continuation line begins with a single space (0x20)
  // or horizontal tab (0x09). Concatenate it with the previous line.
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      out[out.length - 1] = (out[out.length - 1] ?? "") + line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseDate(value: string): Date | null {
  // YYYYMMDD or YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ.
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  return new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    )
  );
}

/** Strip an iCal property of its parameters (e.g. "DTSTART;VALUE=DATE"
 *  becomes just "DTSTART"). */
function bareName(name: string): string {
  const semi = name.indexOf(";");
  return semi === -1 ? name : name.slice(0, semi);
}

export function parseEvents(icsText: string): ParsedEvent[] {
  const lines = unfold(icsText);
  const events: ParsedEvent[] = [];
  let inEvent = false;
  let cur: Partial<ParsedEvent> = {};

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      if (cur.uid && cur.start && cur.end) {
        events.push({
          uid: cur.uid,
          start: cur.start,
          end: cur.end,
          summary: cur.summary ?? "",
          status: cur.status ?? null,
        });
      }
      cur = {};
      continue;
    }
    if (!inEvent) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const namePart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = bareName(namePart);

    if (name === "UID") cur.uid = value.trim();
    else if (name === "DTSTART") cur.start = parseDate(value.trim()) ?? undefined;
    else if (name === "DTEND") cur.end = parseDate(value.trim()) ?? undefined;
    else if (name === "SUMMARY") cur.summary = value.trim();
    else if (name === "STATUS") cur.status = value.trim();
  }
  return events;
}
