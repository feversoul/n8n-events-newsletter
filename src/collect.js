// Puts first tries and retries together, checks every event and returns ONE
// item: { events, report, sources, model_calls, prompt_tokens, completion_tokens }.
// A long page was sent in parts: its parts are put back together here, one
// entry in sources per page, and an event seen in two parts is kept once.
const M = $('Model settings').first().json;
const pages = $('Build prompt').all().map((item) => item.json);
const first = $('Read answers').all().map((item) => item.json);
const second = $('Read retry').isExecuted ? $('Read retry').all().map((item) => item.json) : [];

const plain = (text) =>
  String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
const clean = (value, max) => (typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null);

// The Code node has no URL class, so links are resolved by hand.
const absolute = (href, base) => {
  if (/^https?:\/\//i.test(href)) return href;
  const origin = /^(https?:)\/\/[^/?#]+/i.exec(base ?? '');
  if (!origin || !href) return null;
  if (href.startsWith('//')) return origin[1] + href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // mailto:, tel:, javascript:
  if (href.startsWith('/')) return origin[0] + href;
  const path = base.slice(origin[0].length).replace(/[?#].*$/, '') || '/';
  if (href.startsWith('?') || href.startsWith('#')) return origin[0] + path + href;
  const parts = path.slice(0, path.lastIndexOf('/') + 1).split('/');
  for (const part of href.split('/')) {
    if (part === '..') {
      if (parts.length > 2) parts.splice(-2, 1);
    } else if (part !== '.' && part !== '') parts.splice(-1, 1, part, '');
  }
  return origin[0] + parts.join('/').replace(/\/$/, href.endsWith('/') ? '/' : '');
};

const events = [];
const report = [];
const bySource = new Map();
const seen = new Set();
let model_calls = 0;
let prompt_tokens = 0;
let completion_tokens = 0;

first.forEach((answer, index) => {
  const page = pages[index];
  const retry = second.find((entry) => entry.page_index === index);
  for (const call of [answer, retry]) {
    if (!call) continue;
    model_calls += 1;
    prompt_tokens += call.prompt_tokens;
    completion_tokens += call.completion_tokens;
  }
  const entry = bySource.get(`${page.source}\n${page.url}`) ?? { source: page.source, url: page.url, read: false, events: 0, listed: 0 };
  bySource.set(`${page.source}\n${page.url}`, entry);
  const label = page.parts > 1 ? `part ${page.part} of ${page.parts} ` : '';
  const final = answer.events !== null ? answer : retry ?? answer;
  if (final.events === null) {
    report.push({ source: page.source, url: page.url, level: 'problem', text: `${label}not read: ${final.failure}${retry ? ', also on the second try' : ''}` });
    return;
  }
  entry.read = true;
  entry.listed += final.events.length;

  const pageText = plain(page.text);
  let incomplete = 0;
  for (const raw of final.events) {
    const title = clean(raw?.title ?? raw?.name, 200);
    let date = clean(raw?.date ?? raw?.start_date ?? raw?.startDate, 40);
    let time = clean(raw?.time ?? raw?.start_time, 20);
    // "2026-11-21T19:30:00" is a date and a time
    const stamp = date ? /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec(date) : null;
    if (stamp) {
      date = stamp[1];
      time = time ?? stamp[2];
    }
    if (!title || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) {
      incomplete += 1;
      continue;
    }
    const seenKey = `${page.source}|${date}|${plain(title)}`;
    if (seen.has(seenKey)) continue; // in the overlap of two parts
    if (M.check_title_on_page && !pageText.includes(plain(title))) {
      report.push({ source: page.source, url: page.url, level: 'problem', text: `"${title}" left out: the model named it but the title is not in the page text` });
      continue;
    }
    const clock = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null;
    const link = typeof raw?.url === 'string' && raw.url.trim() ? absolute(raw.url.trim(), page.url) : null;
    seen.add(seenKey);
    events.push({
      title,
      date,
      time: clock && Number(clock[1]) < 24 && Number(clock[2]) < 60 ? `${clock[1].padStart(2, '0')}:${clock[2]}` : null,
      venue: clean(raw?.venue ?? raw?.location, 160),
      url: link ?? (page.url || null),
      summary: clean(raw?.summary ?? raw?.description, 240),
      source: page.source,
      source_url: page.url,
    });
    entry.events += 1;
  }
  if (incomplete) report.push({ source: page.source, url: page.url, level: 'problem', text: `${label}${incomplete} ${incomplete === 1 ? 'entry' : 'entries'} left out: no title or no usable date` });
});

const sources = [...bySource.values()].map(({ source, url, read, events: count }) => ({ source, url, read, events: count }));
for (const entry of bySource.values()) {
  if (entry.read && entry.listed === 0) report.push({ source: entry.source, url: entry.url, level: 'note', text: 'no events found on the page' });
}

return [{ json: { events, report, sources, model_calls, prompt_tokens, completion_tokens } }];
