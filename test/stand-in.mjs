// Stand-in for everything outside n8n in the tests. It makes no model call
// and reads no real website.
//
// 1. Fake event websites (GET /townhall, /whatson, ...), one per case:
//      townhall     clean static HTML, one past event, one far in the future
//      whatson      messy HTML: tables, entities, a script and a comment that
//                   name events which are NOT on the visible page
//      broken       answers HTTP 500 in week 1, works from week 2
//      quiet        a normal page without events
//      spa          built by JavaScript: the HTML has no events in it
//      huge         two events, then 90 KB of text, then one more event: more than
//                   the three parts a page may use, so the last event is cut
//      long         one event, then 14 KB of text, then one more event: two parts
//      ratelimited, garbled, inventor   plain pages; the model misbehaves
//      jsonld       built by JavaScript, but with schema.org data in a script tag
// 2. A model API in the OpenAI chat completions shape (POST /v1/chat/completions).
//    It "finds" the events of its fixture whose title is in the page text it
//    was given, so an event only comes back when the text really reached it.
//    Per site it answers clean JSON, fenced JSON with chatter, JSON with a
//    comma too many, a bare array, cut-off JSON (always), or HTTP 429 (first
//    call of each week). usage = characters / 4, rounded up.
// 3. A mail server on port 1025 that keeps what it gets.
//
//   GET  /__state   { base, week, calls, mails, fetches }
//   POST /__set     { week, rejectMail }

import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';

const MODEL_KEY = 'test-model-key';
const base = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const iso = (days) => new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const human = (days) => new Date(base.getTime() + days * 86_400_000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const state = { week: 1, rejectMail: false, calls: [], mails: [], fetches: [], attempts: {} };

// What the stand-in model knows per site. `title` is as the page writes it.
const fixtures = (week) => ({
  townhall: [
    { title: 'Farmers Market', days: 3, time: '08:00', venue: 'Market Square', url: '/townhall/events/farmers-market', linkFromText: true, summary: 'Fresh produce from farms around town.' },
    { title: 'Open Air Cinema: Local Shorts', days: 5, time: '20:30', venue: 'Castle Yard', url: '/townhall/events/cinema', summary: 'Short films by local film makers.' },
    { title: 'Old Town Walking Tour', days: -2, time: '10:00', venue: 'Town Hall steps', url: null, summary: 'A guided walk through the old town.' },
    { title: 'Winter Gala', days: 30, time: '19:00', venue: 'Town Hall', url: null, summary: 'The yearly gala.' },
    ...(week >= 2 ? [{ title: 'Lantern Parade', days: 6, time: '18:00', venue: 'Riverside', url: null, summary: 'Bring a lantern and walk along the river.' }] : []),
    ...(week >= 3 ? [{ title: 'Harvest Supper', days: 8, time: '18:30', venue: 'Parish Hall', url: null, summary: 'A shared supper.' }] : []),
  ],
  whatson: [
    { title: 'Jazz & Wine Evening', days: 4, time: '19:30', venue: 'Cellar Bar', url: null, summary: 'Live trio and a wine tasting.' },
    { title: 'FARMERS MARKET', days: 3, time: null, venue: 'the market square', url: null, summary: null },
    { title: 'Café Concert – Trio Élan', days: 6, time: '15:00', venue: 'Café Central', url: null, summary: 'Chamber music with coffee.' },
    // Only in a <script> and in an HTML comment of the page:
    { title: 'Ghost Event Gala', days: 4, time: null, venue: null, url: null, summary: null },
    { title: 'Cancelled Comment Concert', days: 4, time: null, venue: null, url: null, summary: null },
  ],
  broken: [{ title: 'Vinyl Fair', days: 5, time: '11:00', venue: 'Old Depot', url: null, summary: 'Records, new and used.' }],
  quiet: [],
  spa: [{ title: 'Invisible Disco', days: 4, time: '22:00', venue: 'Club 9', url: null, summary: null }],
  huge: [
    { title: 'Pottery Workshop', days: 7, time: '14:00', venue: 'Arts Centre', url: null, summary: 'Make a bowl in an afternoon.' },
    { title: 'Midnight Run', days: 8, time: '23:59', venue: 'City Park', url: null, summary: 'Five kilometres by torchlight.' },
  ],
  long: [
    { title: 'Open Mic Night', days: 8, time: '20:00', venue: 'Folk Club', url: null, summary: 'Songs and stories, sign up at the bar.' },
    { title: 'Chess Evening', days: 13, time: '18:30', venue: 'Folk Club', url: null, summary: 'Bring a board if you have one.' },
  ],
  ratelimited: [{ title: 'Swing Dance Social', days: 9, time: '20:00', venue: 'Community Hall', url: null, summary: 'Beginners welcome.' }],
  garbled: [{ title: 'Quiz Night', days: 10, time: '19:00', venue: 'Riverside Club', url: null, summary: null }],
  inventor: [
    { title: 'Book Fair', days: 11, time: '09:00', venue: 'Library', url: null, summary: 'Second-hand books.' },
    { title: 'Poetry Slam', days: null, time: null, venue: 'Library', url: null, summary: 'Date to be announced.' },
  ],
  jsonld: [{ title: 'Harbour Fireworks', days: 12, time: '21:00', venue: 'Old Harbour', url: null, summary: null }],
});

const page = (title, body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`;
const filler = Array.from({ length: 900 }, (_, i) => `<p>Council notice ${i + 1}: the minutes of the meeting are available at the front desk during opening hours.</p>`).join('\n');
const longFiller = Array.from({ length: 140 }, (_, i) => `<p>Club notice ${i + 1}: the rooms can be booked for private parties on weekday evenings, ask at the bar.</p>`).join('\n');
const padding = '<p>We are a small venue run by volunteers. Opening hours are Tuesday to Saturday from ten to six. You can reach us by phone or drop by the front desk. Parking is available behind the building and the bus stops right outside.</p>';

const sites = {
  townhall: (week) =>
    page(
      'Town Hall events',
      `<nav><a href="/">Home</a> <a href="/contact">Contact</a></nav>
<h1>Events at the Town Hall</h1>
<ul>
${fixtures(week)
  .townhall.map((e) => `<li><h3>${e.url ? `<a href="${e.url}">${e.title}</a>` : e.title}</h3><p>${human(e.days)}, ${e.time}, ${e.venue}</p><p>${e.summary}</p></li>`)
  .join('\n')}
</ul>
<footer>Town Hall, 1 Main Street</footer>`,
    ),
  whatson: () =>
    page(
      'What&apos;s on',
      `<!-- removed: Cancelled Comment Concert, ${human(4)} -->
<script>var promo = { title: "Ghost Event Gala", when: "${human(4)}" }; if (a < b) { track(promo) }</script>
<style>.x > .y { color: red }</style>
<TABLE border=1><TR><TD><FONT size=2><b>Jazz</b> &amp; <i>Wine</i> Evening</FONT><TD>${human(4)}<TD>19:30<TD>Cellar Bar
<TR><TD>FARMERS MARKET<TD>${human(3)}<TD>&nbsp;<TD>the market square
<TR><TD>Caf&eacute; Concert &#8211; Trio &Eacute;lan<TD>${human(6)}<TD>15:00<TD>Caf&eacute; Central
</TABLE>
<div><div><div><span>Live trio and a wine tasting. Chamber music with coffee.</span><br><br><br>
${padding}`,
    ),
  broken: () => page('Old Depot', `<h1>Old Depot</h1><p>Vinyl Fair, ${human(5)}, 11:00, Old Depot. Records, new and used.</p>${padding}`),
  quiet: () => page('Quiet Venue', `<h1>Quiet Venue</h1><p>There are no events planned at the moment. Please check back soon.</p>${padding}`),
  spa: () => page('Club 9', '<div id="root"></div><noscript>Please enable JavaScript.</noscript><script src="/spa/app.js"></script>'),
  huge: () =>
    page(
      'Arts Centre',
      `<h1>Arts Centre</h1><p>Pottery Workshop, ${human(7)}, 14:00, Arts Centre. Make a bowl in an afternoon.</p>
${filler}
<p>Midnight Run, ${human(8)}, 23:59, City Park. Five kilometres by torchlight.</p>`,
    ),
  long: () =>
    page(
      'Folk Club',
      `<h1>Folk Club</h1><p>Open Mic Night, ${human(8)}, 20:00, Folk Club. Songs and stories, sign up at the bar.</p>
${longFiller}
<p>Chess Evening, ${human(13)}, 18:30, Folk Club. Bring a board if you have one.</p>`,
    ),
  ratelimited: () => page('Community Hall', `<h1>Community Hall</h1><p>Swing Dance Social, ${human(9)}, 20:00. Beginners welcome.</p>${padding}`),
  garbled: () => page('Riverside Club', `<h1>Riverside Club</h1><p>Quiz Night, ${human(10)}, 19:00.</p>${padding}`),
  inventor: () => page('Library', `<h1>Library</h1><p>Book Fair, ${human(11)}, 09:00. Second-hand books.</p><p>Poetry Slam: date to be announced.</p>${padding}`),
  jsonld: () =>
    page(
      'Harbour',
      '<div id="app"></div><script src="/jsonld/app.js"></script>',
      `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'Harbour Fireworks',
        startDate: `${iso(12)}T21:00:00`,
        location: { '@type': 'Place', name: 'Old Harbour' },
        description: 'Fireworks over the water, best seen from the east pier. Free entry. Food stalls open from six.',
      })}</script>`,
    ),
};

const read = (request) =>
  new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'));
      } catch {
        resolve(null);
      }
    });
  });
const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

function chat(request, response, body) {
  if (request.headers.authorization !== `Bearer ${MODEL_KEY}`) return send(response, 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } });
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const user = String(messages.find((m) => m.role === 'user')?.content ?? '');
  const site = /^Page address: \S*\/([a-z]+)\s*$/m.exec(user)?.[1] ?? 'unknown';
  const text = user.split('Page text:\n')[1] ?? '';
  const call = { site, week: state.week, page_chars: text.length, status: 200, prompt_tokens: 0, completion_tokens: 0, json_mode: body?.response_format?.type === 'json_object', model: body?.model };
  state.calls.push(call);

  const attempt = (state.attempts[`${site}/${state.week}`] = (state.attempts[`${site}/${state.week}`] ?? 0) + 1);
  if (site === 'ratelimited' && attempt === 1) {
    call.status = 429;
    return send(response, 429, { error: { message: 'Rate limit reached for requests', type: 'rate_limit_error' } }, { 'retry-after': '1' });
  }

  const lower = text.toLowerCase();
  const events = (fixtures(state.week)[site] ?? [])
    .filter((e) => lower.includes(e.title.toLowerCase()))
    .map((e) => {
      // linkFromText: the address comes back only when the page text carried it as "Title [address]".
      const at = text.indexOf(`${e.title} [`);
      const url = e.linkFromText ? (at === -1 ? null : text.slice(at + e.title.length + 2).split(']')[0]) : e.url;
      return { title: e.title, date: e.days === null ? null : iso(e.days), time: e.time, venue: e.venue, url, summary: e.summary };
    });
  if (site === 'inventor') events.push({ title: 'Secret Rave', date: iso(11), time: '23:00', venue: 'Unknown', url: null, summary: 'Not on the page at all.' });

  const json = JSON.stringify({ events });
  let content = json;
  if (site === 'whatson') content = `Here are the events I found on the page:\n\n\`\`\`json\n${JSON.stringify({ events }, null, 2)}\n\`\`\`\n\nLet me know if you need anything else!`;
  if (site === 'huge') content = json.replace(/\}\]\}$/, '},]}');
  if (site === 'jsonld') content = JSON.stringify(events);
  if (site === 'garbled') content = json.slice(0, Math.floor(json.length / 2));

  call.prompt_tokens = Math.ceil(messages.reduce((sum, m) => sum + String(m.content ?? '').length, 0) / 4);
  call.completion_tokens = Math.ceil(content.length / 4);
  send(response, 200, {
    id: `chatcmpl-${state.calls.length}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body?.model ?? 'stand-in',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: call.prompt_tokens, completion_tokens: call.completion_tokens, total_tokens: call.prompt_tokens + call.completion_tokens },
  });
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://standin');
  const path = url.pathname;

  if (path === '/__state') return send(response, 200, { base: iso(0), week: state.week, calls: state.calls, mails: state.mails, fetches: state.fetches });
  if (path === '/__set' && request.method === 'POST') {
    const change = await read(request);
    if (change?.week) state.week = Number(change.week);
    if (typeof change?.rejectMail === 'boolean') state.rejectMail = change.rejectMail;
    return send(response, 200, { ok: true });
  }
  if (path === '/v1/chat/completions' && request.method === 'POST') return chat(request, response, await read(request));

  const site = path.slice(1);
  if (request.method === 'GET' && sites[site]) {
    state.fetches.push({ site, week: state.week, agent: request.headers['user-agent'] ?? '' });
    if (site === 'broken' && state.week === 1) {
      response.writeHead(500, { 'content-type': 'text/html' });
      return response.end('<h1>500 Internal Server Error</h1>');
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(sites[site](state.week));
  }
  send(response, 404, { message: 'not part of the stand-in' });
}).listen(8080, () => console.log('stand-in on 8080'));

// --- mail ------------------------------------------------------------------------

const words = (text) =>
  text.replace(/=\?utf-8\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, kind, data) =>
    kind.toLowerCase() === 'b' ? Buffer.from(data, 'base64').toString('utf8') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1').toString('utf8'),
  );

// Enough MIME to find the HTML body and the attachments of a nodemailer message.
function parts(raw, found = []) {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split).replace(/\r\n[ \t]+/g, ' ');
  const body = raw.slice(split + 4);
  const header = (name) => new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(head)?.[1] ?? '';
  const type = header('Content-Type');
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (boundary) {
    for (const piece of body.split(`--${boundary}`).slice(1)) {
      if (piece.startsWith('--')) break;
      parts(piece.replace(/^\r\n/, ''), found);
    }
    return found;
  }
  const encoding = header('Content-Transfer-Encoding').toLowerCase();
  let bytes;
  if (encoding === 'base64') bytes = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (encoding === 'quoted-printable') bytes = Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
  else bytes = Buffer.from(body, 'latin1');
  const disposition = header('Content-Disposition');
  found.push({
    type: type.split(';')[0].trim().toLowerCase(),
    attachment: /attachment/i.test(disposition),
    filename: words(/filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? ''),
    text: bytes.toString('utf8').replace(/\r\n/g, '\n'),
  });
  return found;
}

// The smallest mail server that nodemailer will talk to.
createTcpServer((socket) => {
  let buffer = '';
  let data = null;
  let mail = { from: null, to: [] };
  socket.setEncoding('latin1');
  socket.write('220 stand-in ESMTP\r\n');
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      if (data !== null) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        const raw = buffer.slice(0, end).replace(/\r\n\.\./g, '\r\n.');
        buffer = buffer.slice(end + 5);
        data = null;
        if (state.rejectMail) {
          socket.write('554 5.7.1 rejected by the stand-in\r\n');
        } else {
          const head = raw.slice(0, raw.indexOf('\r\n\r\n')).replace(/\r\n[ \t]+/g, ' ');
          const pieces = parts(raw);
          state.mails.push({
            ...mail,
            subject: words(/^Subject:\s*(.*)$/im.exec(head)?.[1] ?? ''),
            html: pieces.find((p) => p.type === 'text/html' && !p.attachment)?.text ?? '',
            attachments: pieces.filter((p) => p.attachment).map((p) => ({ filename: p.filename, type: p.type, text: p.text })),
          });
          socket.write('250 queued\r\n');
        }
        mail = { from: null, to: [] };
        continue;
      }
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 2);
      const command = line.slice(0, 4).toUpperCase();
      if (command === 'EHLO' || command === 'HELO') socket.write('250 stand-in\r\n');
      else if (command === 'MAIL') {
        mail.from = /<(.*)>/.exec(line)?.[1] ?? line;
        socket.write('250 ok\r\n');
      } else if (command === 'RCPT') {
        mail.to.push(/<(.*)>/.exec(line)?.[1] ?? line);
        socket.write('250 ok\r\n');
      } else if (command === 'DATA') {
        data = '';
        socket.write('354 go ahead\r\n');
      } else if (command === 'QUIT') {
        socket.write('221 bye\r\n');
        socket.end();
      } else socket.write('250 ok\r\n');
    }
  });
}).listen(1025, () => console.log('mail stand-in on 1025'));
