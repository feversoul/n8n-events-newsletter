// End-to-end tests: the real workflows on a real n8n, started over HTTP
// through the "run now" webhook. test/stand-in.mjs plays the event websites,
// the model API and the mail server. No real model and no real website is
// involved. "Week 2" and "week 3" are the same day with changed websites:
// the tests do not wait for the weekly schedule.

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

const N8N = process.env.N8N_URL ?? 'http://localhost:55694';
const STANDIN = process.env.STANDIN_URL ?? 'http://localhost:58094';
const KEY = { 'x-newsletter-key': 'test-newsletter-key', 'content-type': 'application/json' };
const SITE = 'http://standin:8080'; // the stand-in as n8n sees it
const MAX_PAGE_CHARS = 12000; // the default in the Settings node
const MAX_PAGE_PARTS = 3; // the default in the Settings node

const SOURCES = [
  { name: 'Town Hall', url: `${SITE}/townhall` },
  { name: "What's On", url: `${SITE}/whatson` },
  { name: 'Old Depot', url: `${SITE}/broken` },
  { name: 'Gone Away', url: 'http://standin:9/gone' }, // nothing listens there
  { name: 'Quiet Venue', url: `${SITE}/quiet` },
  { name: 'Club 9', url: `${SITE}/spa` },
  { name: 'Arts Centre', url: `${SITE}/huge` },
  { name: 'Community Hall', url: `${SITE}/ratelimited` },
  { name: 'Riverside Club', url: `${SITE}/garbled` },
  { name: 'Library', url: `${SITE}/inventor` },
  { name: 'Harbour', url: `${SITE}/jsonld` },
  { name: 'Folk Club', url: `${SITE}/long` },
  { name: 'Switched Off', url: `${SITE}/quiet`, enabled: false },
];

const WEEK1 = ['Farmers Market', 'Jazz & Wine Evening', 'Open Air Cinema: Local Shorts', 'Café Concert – Trio Élan', 'Pottery Workshop', 'Open Mic Night', 'Swing Dance Social', 'Book Fair', 'Harbour Fireworks', 'Chess Evening'];
// On a page or named by the model, but must never be in a newsletter.
const NEVER = ['Old Town Walking Tour', 'Winter Gala', 'Midnight Run', 'Quiz Night', 'Secret Rave', 'Poetry Slam', 'Ghost Event Gala', 'Cancelled Comment Concert', 'Invisible Disco'];

const standin = async () => (await fetch(`${STANDIN}/__state`)).json();
const steer = (change) => fetch(`${STANDIN}/__set`, { method: 'POST', body: JSON.stringify(change) });
const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const count = (text, needle) => text.toLowerCase().split(needle.toLowerCase()).length - 1;
const sum = (list, field) => list.reduce((total, entry) => total + entry[field], 0);

async function post(path, body, headers = KEY) {
  const response = await fetch(`${N8N}/webhook/newsletter/${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON, for example n8n's "starting up" page */
  }
  return { status: response.status, json, text };
}

// One run of the weekly workflow, with what the stand-in saw during it.
async function run() {
  const beforeRun = await standin();
  const started = Date.now();
  const answer = await post('run');
  assert.equal(answer.status, 200, answer.text);
  const afterRun = await standin();
  return {
    result: answer.json,
    seconds: (Date.now() - started) / 1000,
    calls: afterRun.calls.slice(beforeRun.calls.length),
    mails: afterRun.mails.slice(beforeRun.mails.length),
    fetches: afterRun.fetches.slice(beforeRun.fetches.length),
  };
}

async function until(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value = false;
    try {
      value = await check();
    } catch {
      /* connection refused or reset while n8n starts */
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await sleep(1000);
  }
}

before(async () => {
  await until(async () => (await fetch(`${STANDIN}/__state`)).ok, 60_000);
  // The setup webhook answers once n8n is up; it also puts the sources into the data table.
  await until(async () => {
    const answer = await post('setup', { sources: SOURCES });
    return answer.status === 200 && answer.json?.ok === true;
  }, 240_000);
});

test('the webhooks need the key', async () => {
  const answer = await post('run', {}, { 'content-type': 'application/json' });
  assert.equal(answer.status, 403);
  assert.equal((await standin()).fetches.length, 0, 'nothing was fetched');
});

test('week 1: the right events once, failures reported, the size cap holds', async (t) => {
  const { result, calls, mails, fetches, seconds } = await run();
  t.diagnostic(`run took ${seconds.toFixed(1)} s; ${result.model_calls} model calls, ${result.prompt_tokens} input tokens, ${result.completion_tokens} output tokens (stand-in: characters / 4)`);

  // The events
  assert.deepEqual(result.titles, WEEK1, 'exactly these, sorted by date');
  assert.equal(result.delivered, true);
  assert.equal(result.logged, true, 'a row in newsletter_runs');
  assert.equal(result.pages, 12, 'the switched-off source is not fetched');
  assert.equal(result.pages_read, 8);
  assert.equal(result.events_found, 13);
  assert.equal(result.past, 1, 'Old Town Walking Tour');
  assert.equal(result.duplicates, 1, 'Farmers Market is on two sites');
  assert.equal(result.later, 1, 'Winter Gala is 30 days away');
  assert.equal(result.already_sent, 0);

  // The draft mail
  assert.equal(mails.length, 1);
  const [mail] = mails;
  assert.deepEqual(mail.to, ['editor@example.com']);
  assert.match(mail.subject, /^\[DRAFT\] This week in town, \d{4}-\d{2}-\d{2}: 10 new, \d+ to check$/);
  assert.equal(mail.attachments.length, 1);
  const newsletter = mail.attachments[0].text;
  assert.match(mail.attachments[0].filename, /^newsletter-\d{4}-\d{2}-\d{2}\.html$/);
  for (const title of WEEK1) {
    assert.equal(count(newsletter, esc(title)), 1, `"${title}" once in the newsletter`);
    assert.ok(mail.html.includes(esc(title)), `"${title}" in the preview`);
  }
  for (const title of NEVER) assert.equal(count(mail.html, title), title === 'Secret Rave' ? 1 : 0, `"${title}" is not in the newsletter`);
  assert.equal(count(newsletter, 'Secret Rave'), 0);
  assert.ok(newsletter.includes(`href="${SITE}/townhall/events/farmers-market"`), 'the link of an event is kept in the page text, as an absolute address');
  assert.ok(newsletter.includes(`href="${SITE}/townhall/events/cinema"`), 'a relative link in the model answer is made absolute');
  assert.ok(!newsletter.includes('DRAFT'), 'the attached newsletter has no review box');

  // What went wrong is in the draft, per source
  const said = (source, text) => assert.ok(result.report.some((entry) => entry.source === source && entry.text.includes(text)), `${source}: ${text}\n${JSON.stringify(result.report, null, 1)}`);
  said('Old Depot', 'answered HTTP 500');
  said('Gone Away', 'could not be fetched');
  said('Club 9', 'built by JavaScript');
  said('Riverside Club', 'not usable JSON');
  said('Riverside Club', 'also on the second try');
  said('Library', '"Secret Rave" left out');
  said('Library', '1 entry left out: no title or no usable date');
  said('Arts Centre', 'long page: only the first');
  said('Quiet Venue', 'no events found');
  assert.ok(!result.report.some((entry) => entry.source === 'Folk Club'), 'a page read in two parts has nothing to report');
  assert.equal(result.problems, 6);
  for (const text of ['DRAFT for review', 'answered HTTP 500', 'could not be fetched', 'built by JavaScript', 'not usable JSON', 'Secret Rave', 'long page', 'no events found']) {
    assert.ok(mail.html.includes(text), `the draft says: ${text}`);
  }

  // The model: one call per readable page, one retry where the answer failed
  const callsOf = (site) => calls.filter((call) => call.site === site).length;
  assert.equal(fetches.length, 11, 'every reachable source was fetched once');
  assert.equal(callsOf('spa'), 0, 'no tokens spent on a page without text');
  assert.equal(callsOf('broken'), 0);
  assert.equal(callsOf('whatson'), 1, 'fenced JSON with chatter is repaired, not asked again');
  assert.equal(callsOf('huge'), MAX_PAGE_PARTS, 'a comma too many is repaired, not asked again; the page is read in three parts, no more');
  assert.equal(callsOf('long'), 2, 'a page a little over the cap is read in two parts, nothing cut');
  assert.equal(callsOf('jsonld'), 1, 'a bare array is accepted');
  assert.equal(callsOf('ratelimited'), 2, 'HTTP 429, then one retry');
  assert.equal(callsOf('garbled'), 2, 'cut-off JSON, then one retry');
  assert.equal(calls.length, 14);
  assert.ok(calls.every((call) => call.json_mode && call.model === 'stand-in-small'));

  // Token use is what the API reported
  assert.equal(result.model_calls, 14);
  assert.equal(result.prompt_tokens, sum(calls, 'prompt_tokens'));
  assert.equal(result.completion_tokens, sum(calls, 'completion_tokens'));
  assert.ok(mail.html.includes(`${result.prompt_tokens.toLocaleString('en')} input tokens`));

  // The size cap
  const hugeCalls = calls.filter((call) => call.site === 'huge');
  const huge = hugeCalls[0];
  assert.ok(calls.every((call) => call.page_chars <= MAX_PAGE_CHARS), `page text per call: ${calls.map((call) => call.page_chars).join(', ')}`);
  assert.ok(hugeCalls.every((call) => call.page_chars > MAX_PAGE_CHARS - 400), 'every part of the long page is cut near the cap, not thrown away');
  assert.ok(hugeCalls.every((call) => call.prompt_tokens < 3400), `${huge.prompt_tokens} input tokens for a part of the longest page`);
  t.diagnostic(`per model call (site: characters of page text, input tokens, output tokens): ${calls.map((call) => `${call.site}: ${call.page_chars}, ${call.prompt_tokens}, ${call.completion_tokens}`).join(' | ')}`);
  t.diagnostic(`longest page: ${hugeCalls.length} parts, ${sum(hugeCalls, 'page_chars')} characters of text, ${sum(hugeCalls, 'prompt_tokens')} input tokens`);
});

test('week 2: nothing from week 1 is repeated, new events and a recovered site come through', async (t) => {
  await steer({ week: 2 });
  const { result, mails, calls } = await run();
  t.diagnostic(`${result.model_calls} model calls, ${result.prompt_tokens} input tokens, ${result.completion_tokens} output tokens`);
  assert.deepEqual(result.titles, ['Vinyl Fair', 'Lantern Parade']);
  assert.equal(result.already_sent, 10);
  assert.equal(result.pages_read, 9, 'Old Depot works again');
  assert.equal(mails.length, 1);
  const newsletter = mails[0].attachments[0].text;
  for (const title of [...WEEK1, ...NEVER]) assert.equal(count(newsletter, esc(title)), 0, `"${title}" is not repeated`);
  for (const title of result.titles) assert.equal(count(newsletter, title), 1);
  assert.ok(!result.report.some((entry) => entry.source === 'Old Depot'));
  assert.equal(result.prompt_tokens, sum(calls, 'prompt_tokens'));
});

test('a delivery that fails remembers nothing: the same events are in the next run', async () => {
  await steer({ week: 3, rejectMail: true });
  const failed = await run();
  assert.equal(failed.result.delivered, false);
  assert.ok(failed.result.delivery_error, 'the reason is kept');
  assert.equal(failed.result.logged, true);
  assert.deepEqual(failed.result.titles, ['Harvest Supper']);
  assert.equal(failed.mails.length, 0);

  await steer({ rejectMail: false });
  const again = await run();
  assert.equal(again.result.delivered, true);
  assert.deepEqual(again.result.titles, ['Harvest Supper']);
  assert.equal(count(again.mails[0].attachments[0].text, 'Harvest Supper'), 1);
});

test('a week without new events still sends a draft that says so', async () => {
  const { result, mails } = await run();
  assert.deepEqual(result.titles, []);
  assert.equal(result.already_sent, 13);
  assert.equal(result.delivered, true);
  assert.match(mails[0].subject, /: 0 new/);
  assert.ok(mails[0].attachments[0].text.includes('No new events this week.'));
});
