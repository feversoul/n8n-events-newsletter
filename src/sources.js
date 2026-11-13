// The rows of the data table newsletter_sources that are switched on.
const rows = $input
  .all()
  .map((item) => item.json)
  .filter((row) => row.url && row.enabled !== false);
if (rows.length === 0) {
  throw new Error('No enabled rows in the data table newsletter_sources. Add the pages that list your events there.');
}
return rows.map((row) => ({ json: { source: String(row.name || row.url).trim(), url: String(row.url).trim() } }));
