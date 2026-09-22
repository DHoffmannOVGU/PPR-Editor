import { chromium } from '@playwright/test';
const D = process.env.D;
const api = async (p, init) => { const r = await fetch(`${D}/api${p}`, init); return { status: r.status, text: await r.text() }; };
const model = async () => JSON.parse((await api('/model')).text);
const ok = (c) => c ? 'OK' : 'FAIL';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) r.text().then(t => console.log(`[http ${r.status()}]`, r.request().method(), new URL(r.url()).pathname, t.slice(0,300))); });

await api('/model/reset', { method: 'POST' });
await page.goto(D);
await page.waitForSelector('[data-testid="ppr-flow-canvas"]', { timeout: 30000 });
await page.waitForTimeout(1000);
for (const t of ['product','process','resource']) { await page.getByTestId(`add-standalone-${t}`).click(); await page.waitForTimeout(800); }
await page.locator('.react-flow__controls-fitview').click();
await page.waitForTimeout(1000);

const m0 = await model();
const id = (t) => m0.diagram.usages.find((u) => u.type === t).id;
const P = id('product'), PR = id('process'), R = id('resource');
const handle = (nid, type, hid) => page.getByTestId(`node-ppr-${nid}`).locator('..').locator(`.react-flow__handle.${type}[data-handleid="${hid}"]`);

async function dragBetween(source, target) {
  await page.locator('.react-flow__panel').evaluateAll((panels) => panels.forEach((p) => { p.style.pointerEvents = 'none'; }));
  console.log(`   source count=${await source.count()} target count=${await target.count()}`);
  await source.dragTo(target, { steps: 20 });
  await page.waitForTimeout(1200);
}
async function resolveDialog(label) {
  const dlg = page.locator('[role="dialog"]');
  if (!(await dlg.isVisible().catch(() => false))) { console.log(`   ${label}: no dialog`); return false; }
  console.log(`   ${label} dialog: ${(await dlg.innerText()).replace(/\n+/g,' | ').slice(0,200)}`);
  console.log(`   buttons: ${JSON.stringify(await dlg.getByRole('button').allInnerTexts())}`);
  return true;
}

let before = (await model()).diagram.relationships.length;
await dragBetween(handle(P, 'source', 'source-bottom'), handle(PR, 'target', 'target-top'));
if (await resolveDialog('product->process')) {
  const dlg = page.locator('[role="dialog"]');
  const submit = dlg.getByRole('button', { name: /^(create|add|link|save|confirm)/i }).first();
  if (await submit.isEnabled().catch(() => false)) { await submit.click(); await page.waitForTimeout(1200); }
}
let rels = (await model()).diagram.relationships;
console.log(`connect product->process: ${ok(rels.length === before + 1)} ${JSON.stringify(rels.map(r=>r.kind))}`);

before = rels.length;
await dragBetween(handle(PR, 'source', 'source-right'), handle(R, 'target', 'target-left'));
if (await resolveDialog('process->resource')) {
  const dlg = page.locator('[role="dialog"]');
  const submit = dlg.getByRole('button', { name: /^(create|add|link|save|confirm)/i }).first();
  if (await submit.isEnabled().catch(() => false)) { await submit.click(); await page.waitForTimeout(1200); }
}
rels = (await model()).diagram.relationships;
console.log(`connect process->resource: ${ok(rels.length === before + 1)} ${JSON.stringify(rels.map(r=>`${r.source_id.split('_')[0]} -${r.kind}-> ${r.target_id.split('_')[0]}`))}`);
await browser.close();
