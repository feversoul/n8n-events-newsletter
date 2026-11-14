# n8n events newsletter

[![test](https://github.com/feversoul/n8n-events-newsletter/actions/workflows/test.yml/badge.svg)](https://github.com/feversoul/n8n-events-newsletter/actions/workflows/test.yml)

A weekly newsletter of local events, built by n8n from the websites that list them. Once a week it reads each page, has a small model copy the events out of the text, builds the HTML from a fixed template and mails it to you as a **draft** to review.

Four n8n workflows on **Data Tables** and built-in nodes: no external database, no community nodes, no scraping service. The model is any API that speaks the OpenAI chat completions format, so a free tier or a model on your own machine works.

| Asked in the thread | What you get |
| --- | --- |
| Should the ChatGPT newsletter move to n8n? | The first one (local event websites) as importable workflows. It runs every Monday at 07:00 and you only review the draft. |
| "With n8n I would have to pay for the API" | One model call per page, on text cut at 12,000 characters. The HTML is not written by the model. Each run records the tokens the API reports, in the draft and in a data table, so you can multiply by your provider's price. See [What it costs](#what-it-costs). |
| "Website scraping was not so good. Should I use the HTML scraping?" | No CSS selectors. A plain HTTP fetch, then a Code node turns the HTML into text (scripts, styles, menus and comments removed, links kept, schema.org event data kept). See [What a plain fetch cannot read](#what-a-plain-fetch-cannot-read). |
| ChatGPT gives the HTML, then it is pasted into the email software | The draft arrives by email with the clean newsletter attached as an HTML file. One marked node is the place to call your email tool's API instead. |
| The same event on two sites, or again next week | Each event appears once. Events that were in an earlier issue are remembered in a data table and left out. Past events are dropped. |
| A site that is down, or a model answer that is not JSON | The run goes on. The draft lists every source that was not read, and why. |
| The second newsletter (Instagram, via Scrape Creators) | Not built. See [The Instagram newsletter](#the-instagram-newsletter) for where it would plug in. |

## How it works

```
Every Monday 07:00
  → Sources (data table)  → Fetch page  → Page to text (cut at MAX_PAGE_CHARS)
  → Extract events (sub-workflow: one model call per page, strict JSON, one retry)
  → Pick new events (no past, no duplicates, not already sent)
  → Render newsletter (template in a Code node)
  → Email the draft  → Remember events  → Log run
```

- **`0-setup.json`** creates three data tables: `newsletter_sources` (name, url, enabled), `newsletter_sent` (the events earlier issues had) and `newsletter_runs` (one row per run with pages, events, problems and tokens).
- **`1-weekly-draft.json`** is the pipeline above. Its **Settings** node holds the newsletter name, the addresses, the size cap and how many days ahead an issue looks (14).
- **`2-extract-events.json`** takes items `{ source, url, text }` and returns checked events. Its **Model settings** node holds the API address and the model name.
- **`3-run-now.json`** is optional: a webhook that runs the weekly workflow at once and answers with what it did.

What the model is trusted with, and what not:

- It is asked for JSON only (`response_format: json_object`, which you can switch off). The answer is still checked. Code fences, chatter around the JSON and a comma before a closing bracket are repaired without a second call.
- An answer that cannot be used, an HTTP 429 or an API that is down gets **one** retry after `RETRY_WAIT_SECONDS`. After that the page is reported in the draft and the others go on.
- Every event needs a title and a real date. An event whose title is not in the page text is left out and reported, so an invented event does not reach the newsletter.
- The newsletter HTML comes from the template in **Render newsletter**. Change it there once and it looks the same every week.

Events are remembered only after the draft was delivered. If the mail fails, the next run has the same events.

## What it costs

On your own n8n the workflows cost nothing. The model is the only paid part, and what it costs is:

```
tokens per week = pages × (input tokens per page) + output tokens
cost per week   = input tokens × your input price + output tokens × your output price
```

The size cap bounds the first number. A page at the cap is 12,000 characters of text plus about 860 characters of instructions. In the tests the stand-in API counts one token per 4 characters, which is the usual rule of thumb for English, and reported:

| | Input tokens | Output tokens |
| --- | --- | --- |
| The longest page (91,000 characters of text, cut at the cap) | 3,194 | 38 |
| A short page (280 to 530 characters of text) | 287 to 349 | 4 to 172 |
| A whole run: 11 sources, 8 readable, 10 calls with 2 retries | 5,633 | 566 |

So the worst case is about 3,200 input tokens per page: 10 long pages a week are about 32,000 input tokens a week, or about 139,000 a month. Output is small: about 40 tokens per event (165 for a page with four). Multiply by the price per million tokens of the model you choose. No prices are quoted here because they change and differ per provider. A real tokenizer counts differently from "characters / 4", and text in other languages usually takes more tokens, so look at the real numbers after your first run: they are at the bottom of the review box in the draft and in the data table `newsletter_runs`.

To spend less: point a source at the page that lists only events, lower `MAX_PAGE_CHARS`, or use a local model.

## What a plain fetch cannot read

The workflow reads the HTML the server sends, nothing more.

- **Pages built by JavaScript** arrive almost empty. A page with fewer than 200 characters of text is not sent to the model. The draft says "probably built by JavaScript". If the page carries schema.org event data in a `<script type="application/ld+json">` tag, that is kept and read, which rescues some of these pages. Otherwise look for an RSS feed, an iCal link or an API of that site, or use a scraping service that renders pages.
- **Pages behind a login, a cookie wall or bot protection** come back as an error page or as the wall. An error status is reported. A wall with enough text on it looks like a page without events.
- **Long pages** are cut at `MAX_PAGE_CHARS`. Events below the cut are missing, and the draft says the page was cut.
- **Events on several pages** (page 2, "load more") are not followed. Add each page as its own source.
- ChatGPT's own browsing may do better than this on some sites. If one of your sources is like that, it will show in the first draft.

## The Instagram newsletter

Not built and not tested here. The posts need the Scrape Creators API you already use; a plain fetch of Instagram returns nothing useful. The part that can be shared is **2 Extract events**: it does not care where text comes from. A second workflow would call Scrape Creators with an HTTP Request node, turn each account's recent captions into one item `{ source: "account name", url: "profile address", text: "the captions, one per line with their date" }`, and pass those items to **Extract events**. From **Pick new events** on, the nodes are the same as in the weekly workflow. I have not checked the response shape of Scrape Creators, so that mapping is yours to write.

## Add it to your n8n

For an n8n you already run (2.x). Nothing in it needs more than Data Tables, so it should also work on n8n Cloud, where it was not run.

1. Create two credentials with exactly these names:
   - **OpenAI** credential `Events Newsletter Model` with your API key. For a local model that needs no key, type any text.
   - **SMTP** credential `Events Newsletter SMTP` for the mail server that sends you the draft.
2. Import the four files in `workflows/` (**Import from file**).
3. Open **0 Setup**. Its webhook is for scripted installs and wants a **Header Auth** credential named `Events Newsletter Key` (header `X-Newsletter-Key`): create it, or delete that webhook node together with the **Done** node behind it (without the webhook, a run ends red on **Done** with "No Webhook node found", after the tables were created). Press **Execute workflow**.
4. Open **Data tables → newsletter_sources** and add one row per page that lists events: `name`, `url`, `enabled` ticked. Delete the example row.
5. Open **2 Extract events**, set `MODEL_BASE_URL` and `MODEL` in **Model settings**, and publish it. Examples: `https://api.openai.com/v1`, or `http://localhost:11434/v1` for Ollama on the same machine.
6. Open **1 Weekly draft**. Set `NEWSLETTER_NAME`, `TO_EMAIL` and `FROM_EMAIL` in **Settings**. Open the node **Extract events** and check that it points at workflow 2; pick it from the list if not. Press **Execute workflow** for a first draft, then publish it for the Monday run.
7. `3-run-now.json` is optional. Delete it if you do not want a webhook. If you keep it, open its node **Weekly draft** and pick workflow 1 from the list: an import through the editor gives workflows new ids.

To deliver into your email tool instead of your inbox, replace the node **Email the draft** with a call to that tool's API (the sticky note next to it says what the item contains). Keep both of its outputs connected.

To try everything locally first: `cp .env.example .env`, fill it in, `docker compose up -d`.

## What was tested

`npm run test:e2e` starts n8n 2.47.7 in Docker with a stand-in (`test/stand-in.mjs`) that plays eleven event websites, an OpenAI-compatible model API and a mail server, and starts the weekly workflow five times through the webhook. Last run: 5 tests, 5 passed.

| Case | Result |
| --- | --- |
| Clean static page; messy page with unclosed table cells, entities, and events named only in a script and in a comment | Events on the visible page found. The ones in the script and the comment are not in the newsletter. |
| Same event on two sites, once as "Farmers Market" and once as "FARMERS MARKET" | In the newsletter once. |
| Past event; event 30 days away | Both left out. The far one is not remembered, so it can appear later. |
| Site answers HTTP 500; site refuses the connection | Run goes on, both listed in the draft. |
| Page built by JavaScript | Listed in the draft, no model call made for it. |
| JavaScript page with schema.org event data | Event found. |
| Page without events | Listed as a note. |
| 91,000 characters of text | The model got 11,914 characters. The event below the cut is missing and the draft says the page was cut. No call got more than 12,000. |
| Model answers fenced JSON with chatter; a comma too many; a bare array | Repaired, one call each. |
| Model answers HTTP 429 once | One retry, event found. |
| Model answers cut-off JSON every time | Two calls, page listed in the draft, the other events delivered. |
| Model names an event that is not on the page; an event without a date | Both left out and listed. |
| Second week: two new events, one site works again | Only the two new events. None of the first week's eight. |
| Mail server rejects the draft | Run reports `delivered: false`, nothing remembered. The next run has the same event. |
| A week with nothing new | A draft that says so. |
| Tokens | The totals in the run equal what the stand-in API reported for those calls. |

## What was not tested, and other limits

- **No real model.** The stand-in returns the events of its fixture whose title is in the text it was given. How well a real model reads your pages, and how it handles dates without a year, was not measured.
- **No real websites.** The text reducer was run on hand-written test pages only.
- **Token counts** are the stand-in's "characters / 4".
- **The weekly schedule** was not waited for. The tests start the same workflow through the webhook. "Week 2" in the tests is the same day with changed websites.
- **n8n Cloud** and importing through the editor were not tested. The test stack imports with the n8n CLI. The manual trigger of the setup workflow was not pressed; the tests use its webhook.
- Real SMTP servers (TLS, sign-in) were not tested, and no email tool's API.
- Two events with the same title on the same day count as one, even at different venues.
- A changed event (new date or new title) counts as a new event. A cancelled event that was already sent is not followed up.
- `newsletter_sent` is never cleaned. At a few dozen events a week that is a few thousand rows a year.
- Two runs at the same moment can both send the same events. One scheduled run a week does not do that.
- Check a site's terms before reading it by script.

## Development

The Code nodes live in `src/*.js`. `node scripts/build.mjs` writes `workflows/*.json` from them.

## License

MIT
