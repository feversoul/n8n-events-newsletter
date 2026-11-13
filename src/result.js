return [{ json: { ...$('Run summary').first().json, logged: $input.first().json.id !== undefined } }];
