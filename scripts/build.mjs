// Builds workflows/*.json.
//
// The workflows are plain n8n exports: import them and they run, no build
// needed. This script exists so the JavaScript of the Code nodes can live in
// readable files (src/*.js). After changing one, run:
//   node scripts/build.mjs

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => readFileSync(join(root, 'src', `${name}.js`), 'utf8').trimEnd();

const SOURCES = 'newsletter_sources';
const SENT = 'newsletter_sent';
const RUNS = 'newsletter_runs';
const table = (name) => ({ __rl: true, mode: 'name', value: name });

const IDS = { setup: 'eventsNewsSetup01', weekly: 'eventsNewsWeekly1', extract: 'eventsNewsExtrct1', runNow: 'eventsNewsRunNow1' };

// Credentials are matched by name on import: create them with exactly these
// names before importing and every node picks them up.
const KEY = { httpHeaderAuth: { id: 'eventsNewsKey', name: 'Events Newsletter Key' } };
const MODEL = { openAiApi: { id: 'eventsNewsModel', name: 'Events Newsletter Model' } };
const SMTP = { smtp: { id: 'eventsNewsSmtp', name: 'Events Newsletter SMTP' } };

const SOURCE_COLUMNS = [
  ['name', 'string'], // shown in the draft
  ['url', 'string'], // the page that lists the events
  ['enabled', 'boolean'], // untick to skip a source without deleting it
];
const SENT_COLUMNS = [
  ['event_key', 'string'], // date + title, without case, accents and punctuation
  ['title', 'string'],
  ['event_date', 'string'],
  ['source', 'string'],
  ['run_id', 'string'],
  ['sent_at', 'date'],
];
const RUN_COLUMNS = [
  ['run_id', 'string'],
  ['ran_at', 'date'],
  ['delivered', 'boolean'],
  ['pages', 'number'],
  ['pages_read', 'number'],
  ['events_new', 'number'],
  ['problems', 'number'],
  ['model_calls', 'number'],
  ['prompt_tokens', 'number'],
  ['completion_tokens', 'number'],
  ['report', 'string'],
];

const uuid = (seed) => {
  const hex = createHash('sha1').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const schema = (columns, used) =>
  columns
    .filter(([column]) => used.includes(column))
    .map(([column, type]) => ({
      id: column,
      displayName: column,
      required: false,
      defaultMatch: false,
      display: true,
      type: type === 'date' ? 'dateTime' : type,
      canBeUsedToMatch: true,
    }));

function workflow(id, name, build) {
  const nodes = [];
  const connections = {};
  const w = {
    node(nodeName, type, typeVersion, position, parameters, extra = {}) {
      nodes.push({ parameters, id: uuid(`${id}/${nodeName}`), name: nodeName, type: `n8n-nodes-base.${type}`, typeVersion, position, ...extra });
      return nodeName;
    },
    note(nodeName, lines, position, width, height, color = 4) {
      return w.node(nodeName, 'stickyNote', 1, position, { content: lines.join('\n'), width, height, color });
    },
    link(from, to, output = 0) {
      connections[from] ??= { main: [] };
      while (connections[from].main.length <= output) connections[from].main.push([]);
      connections[from].main[output].push({ node: to, type: 'main', index: 0 });
    },
    chain(...names) {
      for (let i = 0; i < names.length - 1; i++) w.link(names[i], names[i + 1]);
    },
    hook(nodeName, path, position) {
      return w.node(
        nodeName,
        'webhook',
        2,
        position,
        { httpMethod: 'POST', path: `newsletter/${path}`, authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
        { webhookId: uuid(`${id}/webhook/${path}`), credentials: KEY },
      );
    },
    code(nodeName, position, file, replace = {}) {
      let jsCode = source(file);
      for (const [from, to] of Object.entries(replace)) jsCode = jsCode.replaceAll(from, to);
      return w.node(nodeName, 'code', 2, position, { jsCode });
    },
    rows(nodeName, position, tableName, extra = {}) {
      return w.node(
        nodeName,
        'dataTable',
        1.1,
        position,
        { resource: 'row', operation: 'get', dataTableId: table(tableName), matchType: 'allConditions', filters: {}, returnAll: true },
        { alwaysOutputData: true, ...extra },
      );
    },
    insert(nodeName, position, tableName, columns, values) {
      return w.node(nodeName, 'dataTable', 1.1, position, {
        resource: 'row',
        operation: 'insert',
        dataTableId: table(tableName),
        columns: {
          mappingMode: 'defineBelow',
          value: values,
          matchingColumns: [],
          schema: schema(columns, Object.keys(values)),
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
        options: {},
      });
    },
    when(nodeName, position, expression) {
      return w.node(nodeName, 'if', 2.2, position, {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{ id: uuid(`${id}/${nodeName}/condition`), leftValue: `={{ ${expression} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
          combinator: 'and',
        },
        options: { looseTypeValidation: true },
      });
    },
    json(nodeName, position, body) {
      return w.node(nodeName, 'respondToWebhook', 1.1, position, { respondWith: 'json', responseBody: `={{ ${body} }}`, options: { responseCode: 200 } });
    },
    sub(nodeName, position, workflowId) {
      return w.node(nodeName, 'executeWorkflow', 1.2, position, {
        workflowId: { __rl: true, mode: 'id', value: workflowId },
        workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
        mode: 'once',
        options: { waitForSubWorkflow: true },
      });
    },
    called(nodeName, position) {
      return w.node(nodeName, 'executeWorkflowTrigger', 1.1, position, { inputSource: 'passthrough' });
    },
  };
  build(w);
  return { name, nodes, pinData: {}, connections, active: false, settings: { executionOrder: 'v1' }, id };
}

// --- 0. Setup ----------------------------------------------------------------

const setup = workflow(IDS.setup, 'Events Newsletter · 0 Setup', (w) => {
  w.note(
    'About',
    [
      '## Events Newsletter · Setup',
      `Run this once: press **Execute workflow**. It creates three data tables: \`${SOURCES}\` (the pages to read), \`${SENT}\` (events that were already in an issue) and \`${RUNS}\` (one row per run, with the tokens it used).`,
      '',
      `Then open **Data tables → ${SOURCES}** and add one row per page that lists events: a name, the address, and \`enabled\` ticked.`,
      '',
      'The webhook does the same for scripted installs and can take the sources in its body. You can delete it.',
    ],
    [-40, -320],
    640,
    260,
  );
  w.node('Run once', 'manualTrigger', 1, [0, 0], {});
  w.hook('Or call', 'setup', [0, 180]);
  const create = (nodeName, position, tableName, columns) =>
    w.node(nodeName, 'dataTable', 1.1, position, {
      resource: 'table',
      operation: 'create',
      tableName,
      columns: { column: columns.map(([name, type]) => ({ name, type })) },
      options: { createIfNotExists: true },
    });
  create('Create sources', [240, 0], SOURCES, SOURCE_COLUMNS);
  create('Create sent', [460, 0], SENT, SENT_COLUMNS);
  create('Create runs', [680, 0], RUNS, RUN_COLUMNS);
  w.rows('Existing sources', [900, 0], SOURCES);
  w.code('Rows to add', [1120, 0], 'rows-to-add');
  w.when('Any to add?', [1340, 0], '$json.add');
  w.insert('Add source', [1560, -80], SOURCES, SOURCE_COLUMNS, { name: '={{ $json.name }}', url: '={{ $json.url }}', enabled: '={{ $json.enabled }}' });
  w.json('Done', [1780, 0], '{ ok: true }');
  w.link('Run once', 'Create sources');
  w.link('Or call', 'Create sources');
  w.chain('Create sources', 'Create sent', 'Create runs', 'Existing sources', 'Rows to add', 'Any to add?');
  w.link('Any to add?', 'Add source', 0);
  w.link('Any to add?', 'Done', 1);
  w.link('Add source', 'Done');
});

// --- 1. Weekly draft ----------------------------------------------------------

const weekly = workflow(IDS.weekly, 'Events Newsletter · 1 Weekly draft', (w) => {
  w.note(
    'About',
    [
      '## Events Newsletter · Weekly draft',
      `Every Monday at 07:00 it reads the pages in the data table \`${SOURCES}\`, has a model copy the events out of each page, and mails you a **draft** of the newsletter to review.`,
      '',
      '1. **Read pages**: one plain HTTP fetch per source. The HTML is turned into text inside n8n and cut at `MAX_PAGE_CHARS`. A page that fails, or that has no text because it is built by JavaScript, is listed in the draft and does not stop the run.',
      '2. **Extract**: the sub-workflow *2 Extract events* makes one model call per page and returns checked events.',
      `3. **Pick**: past events go, an event on two sites appears once, and events that an earlier issue had (\`${SENT}\`) are left out.`,
      '4. **Render and deliver**: the HTML comes from the template in **Render newsletter**, not from the model.',
      '',
      'Start with **Settings**. Press **Execute workflow** for a draft right now.',
    ],
    [-60, -560],
    820,
    380,
  );
  w.node('Every Monday 07:00', 'scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 7, triggerAtMinute: 0 }] } });
  w.node('Run now', 'manualTrigger', 1, [0, -180], {});
  w.called('Called by another workflow', [0, 180]);
  w.code('Settings', [240, 0], 'settings');
  w.rows('Sources', [460, 0], SOURCES);
  w.code('Enabled sources', [680, 0], 'sources');
  w.node(
    'Fetch page',
    'httpRequest',
    4.2,
    [900, 0],
    {
      url: '={{ $json.url }}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'User-Agent', value: "={{ $('Settings').first().json.user_agent }}" },
          { name: 'Accept', value: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
        ],
      },
      options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } }, timeout: 20000 },
    },
    { onError: 'continueRegularOutput' },
  );
  w.code('Page to text', [1120, 0], 'page-to-text');
  w.when('Any page to read?', [1340, 0], "$('Page to text').all().some((item) => item.json.ok)");
  w.sub('Extract events', [1560, -100], IDS.extract);
  w.rows('Already sent', [1800, 0], SENT);
  w.code('Pick new events', [2020, 0], 'pick');
  w.code('Render newsletter', [2240, 0], 'render');
  w.node(
    'Email the draft',
    'emailSend',
    2.1,
    [2480, 0],
    {
      fromEmail: '={{ $json.from }}',
      toEmail: '={{ $json.to }}',
      subject: '={{ $json.subject }}',
      emailFormat: 'html',
      html: '={{ $json.draft_html }}',
      options: { appendAttribution: false, attachments: 'newsletter' },
    },
    { credentials: SMTP, onError: 'continueErrorOutput' },
  );
  w.when('Anything to remember?', [2720, -100], "$('Render newsletter').first().json.new_events.length > 0");
  w.code('Sent keys', [2940, -200], 'sent-keys');
  w.insert('Remember events', [3160, -200], SENT, SENT_COLUMNS, {
    event_key: '={{ $json.event_key }}',
    title: '={{ $json.title }}',
    event_date: '={{ $json.event_date }}',
    source: '={{ $json.source }}',
    run_id: '={{ $json.run_id }}',
    sent_at: '={{ $json.sent_at }}',
  });
  w.code('Delivery failed', [2720, 140], 'delivery-failed');
  w.code('Run summary', [3400, 0], 'run-summary');
  w.insert('Log run', [3620, 0], RUNS, RUN_COLUMNS, {
    run_id: '={{ $json.run_id }}',
    ran_at: '={{ $json.ran_at }}',
    delivered: '={{ $json.delivered }}',
    pages: '={{ $json.pages }}',
    pages_read: '={{ $json.pages_read }}',
    events_new: '={{ $json.events_new }}',
    problems: '={{ $json.problems }}',
    model_calls: '={{ $json.model_calls }}',
    prompt_tokens: '={{ $json.prompt_tokens }}',
    completion_tokens: '={{ $json.completion_tokens }}',
    report: "={{ $json.report.map((entry) => entry.source + ': ' + entry.text).join('\\n') }}",
  });
  w.code('Result', [3840, 0], 'result');

  for (const trigger of ['Every Monday 07:00', 'Run now', 'Called by another workflow']) w.link(trigger, 'Settings');
  w.chain('Settings', 'Sources', 'Enabled sources', 'Fetch page', 'Page to text', 'Any page to read?');
  w.link('Any page to read?', 'Extract events', 0);
  w.link('Any page to read?', 'Already sent', 1);
  w.chain('Extract events', 'Already sent', 'Pick new events', 'Render newsletter', 'Email the draft');
  w.link('Email the draft', 'Anything to remember?', 0);
  w.link('Email the draft', 'Delivery failed', 1);
  w.link('Anything to remember?', 'Sent keys', 0);
  w.link('Anything to remember?', 'Run summary', 1);
  w.chain('Sent keys', 'Remember events', 'Run summary');
  w.link('Delivery failed', 'Run summary');
  w.chain('Run summary', 'Log run', 'Result');

  w.note(
    'Pages note',
    [
      '### What a plain fetch can read',
      'Only what is in the HTML the server sends. A page that fills itself in with JavaScript (many ticket shops, Instagram, Facebook) arrives almost empty: it is reported in the draft, not guessed. For such a source, look for an RSS feed, an iCal link or an API of that site, or use a scraping service, and feed its text into **Extract events** as items `{ source, url, text }`.',
    ],
    [860, 200],
    560,
    170,
    5,
  );
  w.note(
    'Deliver note',
    [
      '### Swap the delivery here',
      '**Email the draft** sends the draft to you over SMTP. To create the draft in your email tool instead, replace this one node with an HTTP Request (or the tool\'s own n8n node) that creates a draft campaign. The item it gets has `subject`, `newsletter_html` (the clean newsletter), `draft_html` (with the review box) and the file `newsletter`.',
      '',
      'Keep both outputs connected as they are: events are only remembered after a delivery that worked, so a failed delivery is tried again with the same events on the next run.',
    ],
    [2400, 320],
    620,
    220,
    5,
  );
});

// --- 2. Extract events ----------------------------------------------------------

const callModel = (w, nodeName, position) =>
  w.node(
    nodeName,
    'httpRequest',
    4.2,
    position,
    {
      method: 'POST',
      url: "={{ $('Model settings').first().json.model_base_url }}/chat/completions",
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.request) }}',
      // One page at a time with a second in between, which free tiers with a
      // requests-per-minute limit like better than everything at once.
      options: { response: { response: { fullResponse: true, neverError: true } }, timeout: 120000, batching: { batch: { batchSize: 1, batchInterval: 1000 } } },
    },
    { credentials: MODEL, onError: 'continueRegularOutput' },
  );

const extract = workflow(IDS.extract, 'Events Newsletter · 2 Extract events', (w) => {
  w.note(
    'About',
    [
      '## Events Newsletter · Extract events',
      'Called by *1 Weekly draft*. Takes items `{ source, url, text }` and makes **one model call per item** to copy the events out of the text as JSON. Returns one item with the checked events, a report of what went wrong, and the tokens the API says it used.',
      '',
      '- The model is asked for JSON only. Its answer is still checked: code fences and text around the JSON are removed, and every event needs a title and a real date.',
      '- A page whose answer failed (rate limit, unusable JSON, API down) is asked **once** more after `RETRY_WAIT_SECONDS`. If that fails too, the page is reported and the rest goes on.',
      '- An event whose title is not in the page text is left out and reported.',
      '',
      'Start with **Model settings**. Other text sources (for example the posts a scraping API returns) can call this workflow with the same item shape.',
    ],
    [-60, -520],
    820,
    340,
  );
  w.called('Pages in', [0, 0]);
  w.code('Model settings', [220, 0], 'model-settings');
  w.code('Build prompt', [440, 0], 'build-prompt');
  callModel(w, 'Call model', [660, 0]);
  w.code('Read answers', [880, 0], 'read-answers', { __PAGES__: "$('Build prompt')" });
  w.when('Any to retry?', [1100, 0], "$('Read answers').all().some((item) => item.json.events === null)");
  w.node('Wait before retry', 'wait', 1.1, [1320, -140], { amount: "={{ $('Model settings').first().json.retry_wait_seconds }}", unit: 'seconds' }, { webhookId: uuid(`${IDS.extract}/wait`) });
  w.code('Retry list', [1540, -140], 'retry-list');
  callModel(w, 'Call model again', [1760, -140]);
  w.code('Read retry', [1980, -140], 'read-answers', { __PAGES__: "$('Retry list')" });
  w.code('Collect', [2220, 0], 'collect');
  w.chain('Pages in', 'Model settings', 'Build prompt', 'Call model', 'Read answers', 'Any to retry?');
  w.link('Any to retry?', 'Wait before retry', 0);
  w.link('Any to retry?', 'Collect', 1);
  w.chain('Wait before retry', 'Retry list', 'Call model again', 'Read retry', 'Collect');
});

// --- 3. Run now ----------------------------------------------------------------

const runNow = workflow(IDS.runNow, 'Events Newsletter · 3 Run now (webhook)', (w) => {
  w.note(
    'About',
    [
      '## Events Newsletter · Run now',
      'Optional. `POST /webhook/newsletter/run` with the header of the credential **Events Newsletter Key** runs *1 Weekly draft* right away and answers with what it did: events, problems, tokens. The tests of this repository use it.',
    ],
    [-40, -220],
    560,
    160,
  );
  w.hook('Run requested', 'run', [0, 0]);
  w.sub('Weekly draft', [240, 0], IDS.weekly);
  w.json('Answer', [480, 0], '$json');
  w.chain('Run requested', 'Weekly draft', 'Answer');
});

// --- write -------------------------------------------------------------------

export const workflows = {
  '0-setup.json': setup,
  '1-weekly-draft.json': weekly,
  '2-extract-events.json': extract,
  '3-run-now.json': runNow,
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = join(root, 'workflows');
  mkdirSync(out, { recursive: true });
  for (const [file, definition] of Object.entries(workflows)) {
    writeFileSync(join(out, file), `${JSON.stringify(definition, null, 2)}\n`);
    console.log(`workflows/${file}: ${definition.nodes.length} nodes`);
  }
}
