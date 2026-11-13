// Builds the newsletter from a fixed template. No model is involved here, so
// the layout is the same every week and costs nothing. Change the HTML below
// to match your own newsletter.
const S = $('Settings').first().json;
const issue = $input.first().json;

const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (date) => DateTime.fromISO(date).setLocale(S.locale).toFormat('cccc d LLLL');
const FONT = "font-family:Helvetica,Arial,sans-serif";

// --- the newsletter -----------------------------------------------------------
const days = [];
for (const event of issue.new_events) {
  if (days[days.length - 1]?.date !== event.date) days.push({ date: event.date, events: [] });
  days[days.length - 1].events.push(event);
}
const eventHtml = (event) =>
  [
    '<tr><td style="padding:0 0 18px 0">',
    `<div style="${FONT};font-size:17px;line-height:24px;font-weight:bold;color:#111111">${event.url ? `<a href="${esc(event.url)}" style="color:#111111;text-decoration:underline">${esc(event.title)}</a>` : esc(event.title)}</div>`,
    `<div style="${FONT};font-size:14px;line-height:20px;color:#555555">${esc([event.time, event.venue].filter(Boolean).join(' · ') || ' ')}</div>`,
    event.summary ? `<div style="${FONT};font-size:15px;line-height:22px;color:#222222;padding-top:4px">${esc(event.summary)}</div>` : '',
    '</td></tr>',
  ].join('');
const body = days.length
  ? days
      .map((group) =>
        [
          `<tr><td style="${FONT};font-size:13px;line-height:18px;letter-spacing:1px;text-transform:uppercase;color:#888888;border-top:1px solid #dddddd;padding:18px 0 10px 0">${esc(day(group.date))}</td></tr>`,
          ...group.events.map(eventHtml),
        ].join(''),
      )
      .join('')
  : `<tr><td style="${FONT};font-size:15px;line-height:22px;color:#222222;padding:18px 0">No new events this week.</td></tr>`;

const newsletter = [
  '<!doctype html>',
  '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
  `<title>${esc(S.newsletter_name)}</title></head>`,
  '<body style="margin:0;padding:0;background:#f4f4f4">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4"><tr><td align="center" style="padding:24px 12px">',
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff"><tr><td style="padding:28px 28px 12px 28px">',
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">',
  `<tr><td style="${FONT};font-size:26px;line-height:32px;font-weight:bold;color:#111111;padding:0 0 18px 0">${esc(S.newsletter_name)}</td></tr>`,
  body,
  '</table>',
  '</td></tr></table>',
  '</td></tr></table>',
  '</body></html>',
].join('\n');

// --- the notes for you, on top of the draft mail --------------------------------
const problems = issue.report.filter((line) => line.level === 'problem');
const notes = issue.report.filter((line) => line.level !== 'problem');
const c = issue.counts;
const line = (entry) => `<li><b>${esc(entry.source)}</b>: ${esc(entry.text)} (<a href="${esc(entry.url)}">${esc(entry.url)}</a>)</li>`;
const review = [
  `<div style="${FONT};font-size:14px;line-height:21px;color:#111111;background:#fff8e1;border:1px solid #e0c36a;padding:16px 20px;margin:0 0 24px 0">`,
  '<p style="margin:0 0 8px 0"><b>DRAFT for review. Nothing was sent to subscribers.</b> The newsletter without this box is attached as an HTML file.</p>',
  `<p style="margin:0 0 8px 0">${issue.new_events.length} new ${issue.new_events.length === 1 ? 'event' : 'events'} from ${issue.pages_read} of ${issue.pages} pages. Left out: ${c.duplicates} listed twice, ${c.already_sent} already in an earlier issue, ${c.past} in the past, ${c.later} more than ${S.lookahead_days} days away.</p>`,
  problems.length ? `<p style="margin:0 0 4px 0"><b>To check (${problems.length}):</b></p><ul style="margin:0 0 8px 0;padding-left:20px">${problems.map(line).join('')}</ul>` : '<p style="margin:0 0 8px 0">Every page was read.</p>',
  notes.length ? `<p style="margin:0 0 4px 0">Notes:</p><ul style="margin:0 0 8px 0;padding-left:20px">${notes.map(line).join('')}</ul>` : '',
  `<p style="margin:0;color:#555555">Model use this run: ${issue.model_calls} ${issue.model_calls === 1 ? 'call' : 'calls'}, ${issue.prompt_tokens.toLocaleString('en')} input tokens, ${issue.completion_tokens.toLocaleString('en')} output tokens.</p>`,
  '</div>',
].join('\n');

const subject = `[DRAFT] ${S.newsletter_name}, ${issue.today}: ${issue.new_events.length} new${problems.length ? `, ${problems.length} to check` : ''}`;
const fileName = `newsletter-${issue.today}.html`;

return [
  {
    json: {
      ...issue,
      run_id: S.run_id,
      to: S.to_email,
      from: S.from_email,
      subject,
      file_name: fileName,
      newsletter_html: newsletter,
      draft_html: newsletter.replace(/(<body[^>]*>)/, `$1\n${review}`),
    },
    binary: {
      newsletter: { data: Buffer.from(newsletter, 'utf8').toString('base64'), mimeType: 'text/html', fileName, fileExtension: 'html' },
    },
  },
];
