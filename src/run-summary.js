// What this run did, for the data table newsletter_runs and for whoever called.
const issue = $('Render newsletter').first().json;
const failed = $input.first().json.delivery_failed === true;
return [
  {
    json: {
      run_id: issue.run_id,
      ran_at: $now.toISO(),
      delivered: !failed,
      delivery_error: failed ? $input.first().json.reason : null,
      subject: issue.subject,
      pages: issue.pages,
      pages_read: issue.pages_read,
      events_found: issue.counts.found,
      events_new: issue.new_events.length,
      titles: issue.new_events.map((event) => event.title),
      duplicates: issue.counts.duplicates,
      already_sent: issue.counts.already_sent,
      past: issue.counts.past,
      later: issue.counts.later,
      problems: issue.report.filter((entry) => entry.level === 'problem').length,
      report: issue.report,
      model_calls: issue.model_calls,
      prompt_tokens: issue.prompt_tokens,
      completion_tokens: issue.completion_tokens,
    },
  },
];
