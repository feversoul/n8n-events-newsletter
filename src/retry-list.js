// The pages whose first answer failed, with the same request.
const pages = $('Build prompt').all();
return $('Read answers')
  .all()
  .filter((item) => item.json.events === null)
  .map((item) => ({ json: { ...pages[item.json.page_index].json, page_index: item.json.page_index } }));
