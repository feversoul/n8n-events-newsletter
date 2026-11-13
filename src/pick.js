// Decides what goes into this issue: no past events, each event once even
// when several sites list it, nothing that an earlier issue already had,
// nothing further away than LOOKAHEAD_DAYS.
const S = $('Settings').first().json;
const pages = $('Page to text').all().map((item) => item.json);
const extracted = ($('Extract events').isExecuted ? $('Extract events').all()[0]?.json : null) ?? { events: [], report: [], sources: [], model_calls: 0, prompt_tokens: 0, completion_tokens: 0 };
const sent = new Set($input.all().map((item) => item.json.event_key).filter(Boolean));

const plain = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
const last = DateTime.fromISO(S.today).plus({ days: S.lookahead_days }).toFormat('yyyy-MM-dd');

const report = [];
for (const page of pages) {
  if (!page.ok) report.push({ source: page.source, url: page.url, level: 'problem', text: `not read: the page ${page.problem}` });
  else if (page.cut) {
    report.push({
      source: page.source,
      url: page.url,
      level: 'note',
      text: `long page: only the first ${page.text.length.toLocaleString('en')} of ${page.text_chars.toLocaleString('en')} characters were read. Events further down are missing; point the source at a shorter page or raise MAX_PAGE_CHARS`,
    });
  }
}
report.push(...extracted.report);

const counts = { found: extracted.events.length, past: 0, duplicates: 0, already_sent: 0, later: 0 };
const byKey = new Map();
for (const event of extracted.events) {
  if (event.date < S.today) {
    counts.past += 1;
    continue;
  }
  const key = `${event.date}|${plain(event.title)}`;
  const same = byKey.get(key);
  if (same) {
    // The same event on a second site: keep the first, fill its gaps.
    counts.duplicates += 1;
    for (const field of ['time', 'venue', 'summary']) same[field] = same[field] ?? event[field];
    if (!same.also_on.includes(event.source) && event.source !== same.source) same.also_on.push(event.source);
    continue;
  }
  byKey.set(key, { ...event, event_key: key, also_on: [] });
}

const new_events = [];
const later = [];
for (const event of byKey.values()) {
  if (sent.has(event.event_key)) counts.already_sent += 1;
  else if (event.date > last) later.push(event);
  else new_events.push(event);
}
counts.later = later.length;
const order = (a, b) => `${a.date} ${a.time ?? '99'} ${a.title}`.localeCompare(`${b.date} ${b.time ?? '99'} ${b.title}`);
new_events.sort(order);
later.sort(order);

return [
  {
    json: {
      today: S.today,
      new_events,
      later,
      counts,
      report,
      pages: pages.length,
      pages_read: extracted.sources.filter((entry) => entry.read).length,
      model_calls: extracted.model_calls,
      prompt_tokens: extracted.prompt_tokens,
      completion_tokens: extracted.completion_tokens,
    },
  },
];
