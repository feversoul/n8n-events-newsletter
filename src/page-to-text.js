// Turns each fetched page into plain text. A page longer than MAX_PAGE_CHARS is
// split into parts of at most that size, at most MAX_PAGE_PARTS of them; each
// part later gets its own model call. Only what is beyond the last part is cut.
// One answer per source, in the same order as they were asked.
const S = $('Settings').first().json;
const sources = $('Enabled sources').all();

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', bull: '•', middot: '·', deg: '°', euro: '€', pound: '£', copy: '©', reg: '®', trade: '™', szlig: 'ß',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
};
const decode = (text) =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+[0-9]*);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    if (NAMED[name] !== undefined) return NAMED[name];
    // &Eacute; and friends: the capital of a known letter
    const lower = NAMED[name.toLowerCase()];
    return lower !== undefined && name[0] !== name[0].toLowerCase() ? lower.toUpperCase() : whole;
  });

// The Code node has no URL class, so links are resolved by hand.
const absolute = (href, base) => {
  if (/^https?:\/\//i.test(href)) return href;
  const origin = /^(https?:)\/\/[^/?#]+/i.exec(base ?? '');
  if (!origin || !href) return null;
  if (href.startsWith('//')) return origin[1] + href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // mailto:, tel:, javascript:
  if (href.startsWith('/')) return origin[0] + href;
  const path = base.slice(origin[0].length).replace(/[?#].*$/, '') || '/';
  if (href.startsWith('?') || href.startsWith('#')) return origin[0] + path + href;
  const parts = path.slice(0, path.lastIndexOf('/') + 1).split('/');
  for (const part of href.split('/')) {
    if (part === '..') {
      if (parts.length > 2) parts.splice(-2, 1);
    } else if (part !== '.' && part !== '') parts.splice(-1, 1, part, '');
  }
  return origin[0] + parts.join('/').replace(/\/$/, href.endsWith('/') ? '/' : '');
};

function toText(html, base) {
  // Structured data (schema.org) that many event sites put in a script tag.
  // It is worth keeping: it is often there even when the visible page is
  // built by JavaScript.
  const structured = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!/Event/.test(match[1])) continue;
    try {
      structured.push(JSON.stringify(JSON.parse(match[1])));
    } catch {
      structured.push(match[1].replace(/\s+/g, ' ').trim());
    }
  }

  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|template|head|nav|footer|iframe|select)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  if (S.keep_links) {
    text = text.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (whole, q, a, b, c, inner) => {
      const href = decode(a ?? b ?? c ?? '').trim();
      const url = href && !href.startsWith('#') ? absolute(href, base) : null;
      return url ? `${inner} [${url}]` : inner;
    });
  }
  text = text
    .replace(/<\/?(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<\/?(p|div|br|li|ul|ol|tr|table|h[1-6]|section|article|header|main|aside|dl|dt|dd|blockquote|pre|hr|figure|figcaption|form)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const lines = [];
  for (const raw of decode(`${title}\n${text}`).split('\n')) {
    const line = raw
      .replace(/\s+/g, ' ')
      .replace(/^(\| ?)+|( ?\|)+$/g, '')
      .replace(/(\| ){2,}/g, '| ')
      .trim();
    if (line && line !== lines[lines.length - 1]) lines.push(line);
  }
  let out = lines.join('\n');
  if (structured.length) out += `\n\nStructured data on the page:\n${structured.join('\n')}`;
  return out;
}

// Splits at the end of a line. Each part starts with the last few lines of the
// part before it, so an event on the border is whole in one of them. The same
// event may then come back twice; it is listed once.
const PART_OVERLAP_LINES = 5;
function split(text, max, maxParts, overlap) {
  const lines = text.split('\n').flatMap((line) => (line.length <= max ? [line] : line.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g'))));
  const parts = [];
  let from = 0;
  let to = 0;
  while (from < lines.length && parts.length < maxParts) {
    let size = 0;
    to = from;
    while (to < lines.length && size + lines[to].length + 1 <= max) {
      size += lines[to].length + 1;
      to += 1;
    }
    parts.push(lines.slice(from, to).join('\n'));
    from = to < lines.length ? Math.max(to - overlap, from + 1) : to;
  }
  return { parts, read_chars: lines.slice(0, to).join('\n').length };
}

return $input.all().map((item, index) => {
  const { source, url } = sources[index].json;
  const answer = item.json;
  const body = typeof answer.body === 'string' ? answer.body : typeof answer.data === 'string' ? answer.data : '';
  const type = String(answer.headers?.['content-type'] ?? '');
  const page = { source, url, ok: false, problem: null, text: '', html_chars: body.length, text_chars: 0, cut: false };

  if (answer.statusCode === undefined) {
    const reason = answer.error?.message ?? answer.error ?? 'no answer';
    page.problem = `could not be fetched (${String(typeof reason === 'string' ? reason : JSON.stringify(reason)).slice(0, 120)})`;
    return { json: page };
  }
  if (answer.statusCode < 200 || answer.statusCode >= 300) {
    page.problem = `answered HTTP ${answer.statusCode}`;
    return { json: page };
  }
  if (type && !/html|xml|text\/plain/i.test(type)) {
    page.problem = `is not a web page (${type.split(';')[0]})`;
    return { json: page };
  }

  const text = toText(body, url);
  page.text_chars = text.length;
  if (text.length < S.min_page_chars) {
    page.problem = `has almost no text in its HTML (${text.length} characters). It is probably built by JavaScript in the browser, which a plain fetch cannot read`;
    return { json: page };
  }
  page.ok = true;
  const { parts, read_chars } = split(text, S.max_page_chars, S.max_page_parts, PART_OVERLAP_LINES);
  page.parts = parts;
  page.text = parts[0];
  page.read_chars = read_chars;
  page.cut = read_chars < text.length;
  return { json: page };
});
