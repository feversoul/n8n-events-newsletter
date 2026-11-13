// One answer per page, in the same order as they were asked. An answer that
// is not usable JSON is repaired when that is safe (code fences, text around
// the JSON, a comma before a closing bracket). Otherwise the page is marked
// for one more try.
const pages = __PAGES__.all();

function events(content) {
  const attempts = [];
  const text = String(content ?? '').trim();
  attempts.push(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  if (fenced) attempts.push(fenced.trim());
  const from = (fenced ?? text).search(/[{[]/);
  const to = Math.max((fenced ?? text).lastIndexOf('}'), (fenced ?? text).lastIndexOf(']'));
  if (from !== -1 && to > from) {
    const inner = (fenced ?? text).slice(from, to + 1);
    attempts.push(inner, inner.replace(/,\s*([}\]])/g, '$1'));
  }
  for (const attempt of attempts) {
    try {
      const value = JSON.parse(attempt);
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.events)) return value.events;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

return $input.all().map((item, index) => {
  const page = pages[index].json;
  const status = item.json.statusCode;
  let body = item.json.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  const usage = body?.usage ?? {};
  const out = {
    source: page.source,
    url: page.url,
    page_index: page.page_index ?? index,
    events: null,
    failure: null,
    prompt_tokens: Number(usage.prompt_tokens) || 0,
    completion_tokens: Number(usage.completion_tokens) || 0,
  };
  if (status === 200) {
    out.events = events(body?.choices?.[0]?.message?.content);
    if (out.events === null) out.failure = 'the model answer was not usable JSON';
  } else if (status === 429) {
    out.failure = 'the model API said "too many requests" (HTTP 429)';
  } else if (status === undefined) {
    out.failure = `the model API could not be reached (${String(item.json.error?.message ?? item.json.error ?? 'no answer').slice(0, 120)})`;
  } else {
    out.failure = `the model API answered HTTP ${status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 120)}` : ''}`;
  }
  return { json: out };
});
