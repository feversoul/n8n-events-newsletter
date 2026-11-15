// Change these, then save. The other nodes of this workflow read them from here.
const NEWSLETTER_NAME = 'This week in town';
const TO_EMAIL = 'you@example.com'; // where the draft goes for review
const FROM_EMAIL = 'newsletter@example.com';
const MAX_PAGE_CHARS = 12000; // text that goes to the model in one call
const MAX_PAGE_PARTS = 3; // a longer page is split into parts of that size, one call each. Beyond this many parts it is cut: this is what keeps a run cheap.
const MIN_PAGE_CHARS = 200; // a page with less text than this is reported instead of sent to the model (usually a page built by JavaScript)
const LOOKAHEAD_DAYS = 14; // events later than this wait for a later issue
const KEEP_LINKS = true; // keep link addresses in the page text, so events can link to their own page
const LOCALE = 'en'; // language of the day names in the newsletter, e.g. 'de', 'fr', 'es'
const USER_AGENT = 'Mozilla/5.0 (compatible; events-newsletter; n8n)';

return [
  {
    json: {
      newsletter_name: NEWSLETTER_NAME,
      to_email: TO_EMAIL,
      from_email: FROM_EMAIL,
      max_page_chars: MAX_PAGE_CHARS,
      max_page_parts: MAX_PAGE_PARTS,
      min_page_chars: MIN_PAGE_CHARS,
      lookahead_days: LOOKAHEAD_DAYS,
      keep_links: KEEP_LINKS,
      locale: LOCALE,
      user_agent: USER_AGENT,
      today: $now.toFormat('yyyy-MM-dd'), // in the time zone of the workflow
      run_id: String($execution.id),
    },
  },
];
