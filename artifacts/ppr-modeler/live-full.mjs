import { chromium } from '@playwright/test';
const D = process.env.D;
const SHOT = '/tmp/claude-1000/-home-runner-workspace/d52e9952-5ca1-4e13-a404-5659707786e0/scratchpad';
const api = async (p, init) => { const r = await fetch(`${D}/api${p}`, init); return { status: r.status, text: await r.text() }; };
const model = async () => JSON.parse((await api('/model')).text);
const problems = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') problems.push('console.error: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 200)));
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
const ok = (c) => c ? 'OK' : 'FAIL';

await api('/model/reset', { method: 'POST' });
await page.goto(D);
await page.waitForSelector('[data-testid="ppr-flow-canvas"]', { timeout: 30000 });
await page.waitForTimeout(1200);

// 1. sidebar quick create
for (const type of ['product', 'process', 'resource']) {
  const before = (await model()).diagram.usages.length;
  await page.getByTestId(`add-standalone-${type}`).click();
  await page.waitForTimeout(900);
  const after = (await model()).diagram.usages.length;
  console.log(`1. sidebar create ${type}: ${ok(after === before + 1)} (${before}->${after})`);
}
let m = await model();
const byType = (t) => m.diagram.usages.find((u) => u.type === t);
const product = byType('product'), process_ = byType('process'), resource = byType('resource');
const node = (id) => page.locator(`[data-testid="node-ppr-${id}"]`);

// 2. node visibility + click selection
for (const el of [product, process_, resource]) {
  console.log(`2. node visible ${el.type}: ${ok(await node(el.id).isVisible().catch(() => false))}`);
}
await node(product.id).click();
await page.waitForTimeout(700);
console.log(`2. click selects in inspector: ${ok(await page.locator('#name').inputValue().catch(() => '') === product.name)}`);

// 3. connect product -> process (handle drag)
async function connect(sourceId, targetId) {
  const s = page.locator(`[data-testid="node-ppr-${sourceId}"] .react-flow__handle.source`).first();
  const t = page.locator(`[data-testid="node-ppr-${targetId}"] .react-flow__handle.target`).first();
  const sb = await s.boundingBox(), tb = await t.boundingBox();
  if (!sb || !tb) return 'no-handles';
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  return 'done';
}
let before = (await model()).diagram.relationships.length;
await connect(product.id, process_.id);
let after = (await model()).diagram.relationships.length;
const dlg = await page.locator('[role="dialog"]').isVisible().catch(() => false);
console.log(`3. connect product->process: rels ${before}->${after}, dialog=${dlg}`);
if (dlg) {
  const txt = (await page.locator('[role="dialog"]').innerText()).replace(/\n+/g, ' | ').slice(0, 200);
  console.log(`   dialog: ${txt}`);
  const create = page.getByTestId('button-confirm-relationship').or(page.getByRole('button', { name: /create|add|confirm/i })).first();
  if (await create.isVisible().catch(() => false)) { await create.click(); await page.waitForTimeout(900); }
  after = (await model()).diagram.relationships.length;
  console.log(`   after submit: rels=${after} ${ok(after === before + 1)}`);
} else {
  console.log(`   auto-created: ${ok(after === before + 1)}`);
}

// 4. connect resource -> process (performs)
before = (await model()).diagram.relationships.length;
await connect(process_.id, resource.id);
after = (await model()).diagram.relationships.length;
if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) {
  const create = page.getByRole('button', { name: /create|add|confirm/i }).first();
  if (await create.isVisible().catch(() => false)) { await create.click(); await page.waitForTimeout(900); }
  after = (await model()).diagram.relationships.length;
}
console.log(`4. connect process<->resource: rels ${before}->${after} ${ok(after === before + 1)}`);

// 5. drag a node and persist position
m = await model();
const beforePos = m.diagram.usages.find((u) => u.id === resource.id);
const nb = await node(resource.id).boundingBox();
await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
await page.mouse.down();
await page.mouse.move(nb.x + nb.width / 2 + 160, nb.y + nb.height / 2 + 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1200);
m = await model();
const afterPos = m.diagram.usages.find((u) => u.id === resource.id);
console.log(`5. drag persists position: ${ok(afterPos.x !== beforePos.x || afterPos.y !== beforePos.y)} (${beforePos.x},${beforePos.y} -> ${afterPos.x},${afterPos.y})`);

// 6. quick-connect drag to empty canvas creates a new element
before = (await model()).diagram.usages.length;
const pb = await node(process_.id).boundingBox();
const bottom = page.locator(`[data-testid="node-ppr-${process_.id}"] .react-flow__handle.source-bottom, [data-testid="node-ppr-${process_.id}"] [data-handleid="source-bottom"]`).first();
const bb = await bottom.boundingBox().catch(() => null);
if (bb) {
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + 40, bb.y + 320, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  after = (await model()).diagram.usages.length;
  console.log(`6. quick-connect to canvas creates element: ${ok(after === before + 1)} (${before}->${after})`);
} else console.log('6. quick-connect: source-bottom handle not found');

// 7. switch perspectives
for (const [id, label] of [['button-view-product','Product'],['button-view-process-specification','Process'],['button-view-resource','Resource'],['button-view-ppr-levels','Levels'],['button-view-item','Item'],['button-view-library','Library'],['button-view-graph','PPR']]) {
  await page.getByTestId(id).click().catch(() => {});
  await page.waitForTimeout(800);
  const crashed = (await page.locator('body').innerText()).includes('Something went wrong');
  console.log(`7. surface ${label}: ${ok(!crashed)}`);
}

await page.screenshot({ path: `${SHOT}/final.png` });
console.log('--- problems ---');
for (const p of [...new Set(problems)]) console.log(p);
await browser.close();
