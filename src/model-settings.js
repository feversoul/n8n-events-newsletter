// Change these, then save. Any API that speaks the OpenAI "chat completions"
// format works: OpenAI, a provider with a free tier, or a model on your own
// machine (Ollama: http://localhost:11434/v1). The key is in the credential
// "Events Newsletter Model".
const MODEL_BASE_URL = 'https://api.openai.com/v1'; // without /chat/completions
const MODEL = 'gpt-4o-mini'; // a small model is enough: it only copies events out of text
const JSON_MODE = true; // asks the API for JSON only. Set to false if your server rejects "response_format".
const RETRY_WAIT_SECONDS = 20; // a page whose answer failed (rate limit, bad JSON) is asked once more after this pause
const CHECK_TITLE_ON_PAGE = true; // leave out an event whose title is not in the page text (a guard against invented events)

return [
  {
    json: {
      model_base_url: MODEL_BASE_URL.replace(/\/+$/, ''),
      model: MODEL,
      json_mode: JSON_MODE,
      retry_wait_seconds: RETRY_WAIT_SECONDS,
      check_title_on_page: CHECK_TITLE_ON_PAGE,
      today: $now.toFormat('yyyy-MM-dd'),
    },
  },
];
