// The draft could not be delivered. Nothing is remembered, so the same
// events are in the next run.
const error = $input.first().json.error;
return [{ json: { delivery_failed: true, reason: String(error?.message ?? error ?? 'unknown error').slice(0, 300) } }];
