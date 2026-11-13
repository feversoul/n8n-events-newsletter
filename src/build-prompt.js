// One request per page. What comes in: items { source, url, text }.
// Anything that can produce that shape can use this workflow, not only web pages.
const M = $('Model settings').first().json;

const system = [
  'You copy events out of the text of a web page. You answer with JSON only, in this shape:',
  '{"events":[{"title":"...","date":"YYYY-MM-DD","time":"HH:MM","venue":"...","url":"...","summary":"..."}]}',
  'Rules:',
  '- Only events that are on the page. Never add or guess an event.',
  '- title: as written on the page.',
  '- date: the day the event starts. When the page gives no year, use the next such day on or after today.',
  '- time: start time in 24-hour HH:MM, or null when the page gives none.',
  '- venue: the place as written, or null.',
  '- url: the address of the event\'s own page when the text gives one in [brackets], or null.',
  '- summary: one plain sentence of at most 160 characters taken from the page, or null.',
  '- An event without a date: date is null.',
  '- No events on the page: {"events":[]}',
].join('\n');

return $('Pages in')
  .all()
  .filter((item) => item.json.ok !== false && typeof item.json.text === 'string' && item.json.text.trim() !== '')
  .map((item) => {
    const { source, url, text } = item.json;
    return {
      json: {
        source: String(source ?? url ?? 'page'),
        url: String(url ?? ''),
        text,
        request: {
          model: M.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Source: ${source}\nPage address: ${url}\nToday: ${M.today}\n\nPage text:\n${text}` },
          ],
          ...(M.json_mode ? { response_format: { type: 'json_object' } } : {}),
        },
      },
    };
  });
