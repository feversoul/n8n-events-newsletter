// One row per event that went into the draft, so later issues leave it out.
const issue = $('Render newsletter').first().json;
return issue.new_events.map((event) => ({
  json: { event_key: event.event_key, title: event.title, event_date: event.date, source: event.source, run_id: issue.run_id, sent_at: $now.toISO() },
}));
