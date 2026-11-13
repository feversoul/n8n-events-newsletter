// Which rows to put into newsletter_sources. Called by hand: one example row
// when the table is empty. Called through the webhook with
// { "sources": [{ "name": "...", "url": "..." }] }: those that are not there yet.
const existing = new Set($input.all().map((item) => item.json.url).filter(Boolean));
const asked = $('Or call').isExecuted ? $('Or call').first().json.body?.sources : null;
let rows = [];
if (Array.isArray(asked)) {
  rows = asked.filter((row) => row && row.url && !existing.has(row.url)).map((row) => ({ name: String(row.name ?? row.url), url: String(row.url), enabled: row.enabled !== false }));
} else if (existing.size === 0) {
  rows = [{ name: 'Example (replace this row)', url: 'https://example.com/events', enabled: false }];
}
return rows.length ? rows.map((row) => ({ json: { add: true, ...row } })) : [{ json: { add: false } }];
