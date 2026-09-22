const baseUrl = (process.env.RELEASE_BASE_URL ?? `http://127.0.0.1:${process.env.RELEASE_API_PORT ?? '8080'}`)
  .replace(/\/+$/, '');
const allowMutations = process.env.RELEASE_SMOKE_ALLOW_MUTATIONS === '1';
const mcpApiKey = process.env.RELEASE_MCP_API_KEY;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Plain-text exchange responses are valid for import endpoints.
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${text.slice(0, 400)}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function run() {
  const health = await request('/api/healthz');
  assert(health?.status === 'ok', 'health check did not return { status: "ok" }');

  const mcp = await request('/api/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(mcpApiKey ? { authorization: `Bearer ${mcpApiKey}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'ppr-release-smoke', version: '1' },
      },
    }),
  });
  assert(
    mcp?.result?.serverInfo?.name === 'ppr-engineering-modeler'
      && mcp?.result?.capabilities?.tools,
    'the deployed MCP endpoint did not initialize with tool capabilities',
  );

  const model = await request('/api/model');
  assert(typeof model?.id === 'string', 'model response did not include an id');
  assert(Array.isArray(model?.library?.definitions), 'model response did not include library definitions');
  assert(Array.isArray(model?.diagram?.usages), 'model response did not include diagram usages');
  assert(Array.isArray(model?.diagram?.relationships), 'model response did not include relationships');

  const validation = await request('/api/model/validate', jsonOptions('POST', model));
  assert(validation?.valid === true, 'the current model did not pass validation');

  for (const format of ['json', 'sysml', 'sysml-ppr', 'automationml']) {
    const exported = await request(`/api/model/export/${format}`);
    assert(exported?.format === format && typeof exported.content === 'string' && exported.content.length > 0,
      `${format} export did not return content`);
  }

  const initialRevisions = await request('/api/model/revisions');
  assert(Array.isArray(initialRevisions) && initialRevisions.length > 0, 'revision history was empty');

  if (!allowMutations) {
    console.log(`Release smoke passed in read-only mode against ${baseUrl}`);
    console.log('Mutating checks skipped; set RELEASE_SMOKE_ALLOW_MUTATIONS=1 only for disposable or staging data.');
    return;
  }

  const saved = await request('/api/model?checkpoint=false', jsonOptions('PUT', model));
  const reloaded = await request('/api/model');
  assert(saved?.id === model.id && reloaded?.id === model.id, 'Save/reload did not preserve the model');

  const latestRevision = initialRevisions[0];
  const restored = await request(
    `/api/model/revisions/${encodeURIComponent(latestRevision.id)}/restore`,
    { method: 'POST' },
  );
  assert(restored?.id === model.id, 'revision restore did not return the active model');

  const smokeSysml = `library package PPR {
  abstract item def Product;
  abstract action def Process;
  abstract part def Resource;
}
package <release_smoke_model> 'Release smoke model' {
  private import PPR::*;
  item def <release_smoke_product> 'Release smoke product' :> Product;
}`;
  const imported = await request('/api/model/import/sysml', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: smokeSysml,
  });
  assert(
    imported?.name === 'Release smoke model'
      && imported.library.definitions.some((definition) => definition.name === 'Release smoke product'),
    'SysML import did not return the smoke model',
  );
  await request('/api/model?checkpoint=false', jsonOptions('PUT', model));

  const session = await request('/api/collaboration/sessions', { method: 'POST' });
  assert(session?.session_id && /^\d{6}$/.test(session.code), 'collaboration session creation failed');
  const joined = await request('/api/collaboration/join', jsonOptions('POST', {
    session_id: session.session_id,
    code: session.code,
  }));
  assert(joined?.session_id === session.session_id, 'collaboration session join failed');
  await request(`/api/collaboration/sessions/${encodeURIComponent(session.session_id)}/close`, jsonOptions('POST', {
    owner_token: session.owner_token,
  }));

  console.log(`Release smoke passed with mutating checks against ${baseUrl}`);
}

run().catch((error) => {
  console.error(`Release smoke failed: ${error.message}`);
  process.exitCode = 1;
});
