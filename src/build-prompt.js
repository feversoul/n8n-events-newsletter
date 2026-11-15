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

// A long page arrives as parts: one request each.
return $('Pages in')
  .all()
  .filter((item) => item.json.ok !== false && ((Array.isArray(item.json.parts) && item.json.parts.length) || (typeof item.json.text === 'string' && item.json.text.trim() !== '')))
  .flatMap((item) => {
    const { source, url } = item.json;
    const parts = Array.isArray(item.json.parts) && item.json.parts.length ? item.json.parts : [item.json.text];
    return parts
      .filter((text) => typeof text === 'string' && text.trim() !== '')
      .map((text, index) => ({
        json: {
          source: String(source ?? url ?? 'page'),
          url: String(url ?? ''),
          text,
          part: index + 1,
          parts: parts.length,
          request: {
            model: M.model,
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: `Source: ${source}\nPage address: ${url}\nToday: ${M.today}\n${parts.length > 1 ? `Part ${index + 1} of ${parts.length} of the page text. An event may continue from the part before. Copy only events that are in this part.\n` : ''}\nPage text:\n${text}`,
              },
            ],
            ...(M.json_mode ? { response_format: { type: 'json_object' } } : {}),
          },
        },
      }));
  });
