# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: graph-interactions.spec.ts >> keeps center snapping usable when zoomed in or out and clears canceled pointer drags
- Location: src/e2e/graph-interactions.spec.ts:1476:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByTestId('alignment-guide-vertical')
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for getByTestId('alignment-guide-vertical')
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e4]:
    - heading "Something went wrong" [level=1] [ref=e5]
    - paragraph [ref=e6]: This part of the app hit an error. The rest of the app is still running.
    - generic [ref=e7]: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.
    - button "Try again" [ref=e8]
  - region "Notifications alt+T"
```

# Test source

```ts
  1406 | });
  1407 | 
  1408 | test('keeps center guides distinguishable in forced-colors mode without persisting guide state', async ({ page }) => {
  1409 |   await page.emulateMedia({ forcedColors: 'active' });
  1410 |   const api = await openModel(page);
  1411 |   const source = page.locator('.react-flow__node[data-id="process-work"]');
  1412 |   const target = page.locator('.react-flow__node[data-id="product-input"]');
  1413 |   await expect.poll(() => page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(true);
  1414 |   await page.waitForTimeout(350);
  1415 | 
  1416 |   const sourceBox = await source.boundingBox();
  1417 |   const targetBox = await target.boundingBox();
  1418 |   expect(sourceBox).not.toBeNull();
  1419 |   expect(targetBox).not.toBeNull();
  1420 | 
  1421 |   const updateRequest = page.waitForRequest(
  1422 |     (request) =>
  1423 |       request.method() === 'PATCH' &&
  1424 |       request.url().endsWith('/api/model/elements/process-work'),
  1425 |   );
  1426 |   const dragStart = { x: sourceBox!.x + sourceBox!.width / 2, y: sourceBox!.y + sourceBox!.height / 2 };
  1427 |   await page.mouse.move(dragStart.x, dragStart.y);
  1428 |   await page.mouse.down();
  1429 |   await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 16 });
  1430 | 
  1431 |   const firstMoveSourceBox = await source.boundingBox();
  1432 |   const firstMoveTargetBox = await target.boundingBox();
  1433 |   expect(firstMoveSourceBox).not.toBeNull();
  1434 |   expect(firstMoveTargetBox).not.toBeNull();
  1435 |   const centerCorrection = {
  1436 |     x: (firstMoveTargetBox!.x + firstMoveTargetBox!.width / 2) - (firstMoveSourceBox!.x + firstMoveSourceBox!.width / 2),
  1437 |     y: (firstMoveTargetBox!.y + firstMoveTargetBox!.height / 2) - (firstMoveSourceBox!.y + firstMoveSourceBox!.height / 2),
  1438 |   };
  1439 |   await page.mouse.move(
  1440 |     firstMoveTargetBox!.x + firstMoveTargetBox!.width / 2 + centerCorrection.x,
  1441 |     firstMoveTargetBox!.y + firstMoveTargetBox!.height / 2 + centerCorrection.y,
  1442 |     { steps: 4 },
  1443 |   );
  1444 | 
  1445 |   const guides = page.locator('.ppr-alignment-guide');
  1446 |   await expect(guides).toHaveCount(2);
  1447 |   const guideStyles = await guides.evaluateAll((elements) => elements.map((element) => {
  1448 |     const style = getComputedStyle(element);
  1449 |     return {
  1450 |       axis: element.getAttribute('data-axis'),
  1451 |       color: style.borderColor,
  1452 |       forcedColorAdjust: style.forcedColorAdjust,
  1453 |       style: style.borderStyle,
  1454 |       width: element.getAttribute('data-axis') === 'vertical' ? style.borderLeftWidth : style.borderTopWidth,
  1455 |     };
  1456 |   }));
  1457 |   expect(guideStyles).toEqual(expect.arrayContaining([
  1458 |     expect.objectContaining({ axis: 'vertical', forcedColorAdjust: 'none', style: 'dashed' }),
  1459 |     expect.objectContaining({ axis: 'horizontal', forcedColorAdjust: 'none', style: 'dashed' }),
  1460 |   ]));
  1461 |   expect(guideStyles.every((guide) => guide.color !== 'transparent' && guide.width !== '0px')).toBe(true);
  1462 | 
  1463 |   await page.mouse.up();
  1464 |   const request = await updateRequest;
  1465 |   const updates = request.postDataJSON() as { x?: number; y?: number };
  1466 |   await expect(guides).toHaveCount(0);
  1467 |   const input = initialModel.diagram.usages.find((element) => element.id === 'product-input');
  1468 |   expect(Math.abs((updates.x ?? 0) - (input?.x ?? 0))).toBeLessThanOrEqual(1);
  1469 |   expect(Math.abs((updates.y ?? 0) - (input?.y ?? 0))).toBeLessThanOrEqual(1);
  1470 |   expect(api.getModel().diagram.usages.find((element) => element.id === 'process-work')).toMatchObject({
  1471 |     x: input?.x,
  1472 |     y: input?.y,
  1473 |   });
  1474 | });
  1475 | 
  1476 | test('keeps center snapping usable when zoomed in or out and clears canceled pointer drags', async ({ page }) => {
  1477 |   const api = await openModel(page);
  1478 |   const source = page.locator('.react-flow__node[data-id="resource-tool"]');
  1479 |   const target = page.locator('.react-flow__node[data-id="process-work"]');
  1480 | 
  1481 |   const getZoom = () => page.locator('.react-flow__viewport').evaluate((viewport) => {
  1482 |     const transform = getComputedStyle(viewport).transform;
  1483 |     const scale = transform.match(/^matrix\(([^,]+),/);
  1484 |     return scale ? Number(scale[1]) : 1;
  1485 |   });
  1486 | 
  1487 |   const dragNearTargetAtCurrentZoom = async () => {
  1488 |     const sourceBox = await source.boundingBox();
  1489 |     const targetBox = await target.boundingBox();
  1490 |     expect(sourceBox).not.toBeNull();
  1491 |     expect(targetBox).not.toBeNull();
  1492 | 
  1493 |     const pointer = {
  1494 |       x: sourceBox!.x + sourceBox!.width / 2,
  1495 |       y: sourceBox!.y + sourceBox!.height / 2,
  1496 |     };
  1497 |     const targetCenter = {
  1498 |       x: targetBox!.x + targetBox!.width / 2,
  1499 |       y: targetBox!.y + targetBox!.height / 2,
  1500 |     };
  1501 |     const screenOffset = 4;
  1502 | 
  1503 |     await page.mouse.move(pointer.x, pointer.y);
  1504 |     await page.mouse.down();
  1505 |     await page.mouse.move(targetCenter.x + screenOffset, targetCenter.y + screenOffset, { steps: 12 });
> 1506 |     await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(1);
       |                                                                ^ Error: expect(locator).toHaveCount(expected) failed
  1507 |     await page.mouse.up();
  1508 | 
  1509 |     await expect.poll(() => api.requests.filter((request) =>
  1510 |       request.method() === 'PATCH' &&
  1511 |       request.url().endsWith('/api/model/elements/resource-tool'),
  1512 |     ).length).toBeGreaterThan(0);
  1513 |     const updates = api.requests
  1514 |       .filter((request) =>
  1515 |         request.method() === 'PATCH' &&
  1516 |         request.url().endsWith('/api/model/elements/resource-tool'),
  1517 |       )
  1518 |       .at(-1)?.postDataJSON() as { x?: number; y?: number } | undefined;
  1519 |     expect(updates).toEqual(expect.objectContaining({
  1520 |       x: expect.any(Number),
  1521 |       y: expect.any(Number),
  1522 |     }));
  1523 |     const targetModel = initialModel.diagram.usages.find((element) => element.id === 'process-work');
  1524 |     expect(Math.abs((updates?.x ?? 0) - (targetModel?.x ?? 0))).toBeLessThanOrEqual(1);
  1525 |     expect(screenOffset).toBeLessThanOrEqual(6);
  1526 |     await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(0);
  1527 |     await expect(page.getByTestId('alignment-guide-horizontal')).toHaveCount(0);
  1528 |   };
  1529 | 
  1530 |   await page.waitForTimeout(400);
  1531 |   const zoomIn = page.locator('.react-flow__controls-zoomin');
  1532 |   for (let index = 0; index < 4 && await zoomIn.isEnabled(); index += 1) {
  1533 |     await zoomIn.click();
  1534 |   }
  1535 |   await expect.poll(getZoom).toBeGreaterThan(1);
  1536 |   await dragNearTargetAtCurrentZoom();
  1537 | 
  1538 |   const zoomOut = page.locator('.react-flow__controls-zoomout');
  1539 |   for (let index = 0; index < 10 && await zoomOut.isEnabled(); index += 1) {
  1540 |     await zoomOut.click();
  1541 |   }
  1542 |   await expect.poll(getZoom).toBeLessThan(0.5);
  1543 |   await dragNearTargetAtCurrentZoom();
  1544 | 
  1545 |   const sourceBox = await source.boundingBox();
  1546 |   const targetBox = await target.boundingBox();
  1547 |   expect(sourceBox).not.toBeNull();
  1548 |   expect(targetBox).not.toBeNull();
  1549 |   await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  1550 |   await page.mouse.down();
  1551 |   await page.mouse.move(
  1552 |     targetBox!.x + targetBox!.width / 2 + 4,
  1553 |     targetBox!.y + targetBox!.height / 2 + 4,
  1554 |     { steps: 4 },
  1555 |   );
  1556 |   await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(1);
  1557 |   await page.evaluate(() => {
  1558 |     window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
  1559 |   });
  1560 |   await expect(page.getByTestId('alignment-guide-vertical')).toHaveCount(0);
  1561 |   await expect(page.getByTestId('alignment-guide-horizontal')).toHaveCount(0);
  1562 | });
  1563 | 
  1564 | test('persists a dragged node position through the model API', async ({ page }) => {
  1565 |   const api = await openModel(page);
  1566 |   const node = page.locator('.react-flow__node[data-id="process-work"]');
  1567 |   const before = api.getModel().diagram.usages.find((element) => element.id === 'process-work');
  1568 |   const nodeBox = await node.boundingBox();
  1569 |   expect(nodeBox).not.toBeNull();
  1570 | 
  1571 |   const updateRequest = page.waitForRequest(
  1572 |     (request) =>
  1573 |       request.method() === 'PATCH' &&
  1574 |       request.url().endsWith('/api/model/elements/process-work'),
  1575 |   );
  1576 |   const dragStart = { x: nodeBox!.x + 32, y: nodeBox!.y + 20 };
  1577 |   await node.hover({ position: { x: 32, y: 20 } });
  1578 |   await page.waitForTimeout(75);
  1579 |   await page.mouse.down();
  1580 |   await page.mouse.move(dragStart.x + 96, dragStart.y + 48, { steps: 16 });
  1581 |   await page.mouse.up();
  1582 | 
  1583 |   const request = await updateRequest;
  1584 |   const updates = request.postDataJSON() as { x?: number; y?: number };
  1585 |   expect(updates.x).toEqual(expect.any(Number));
  1586 |   expect(updates.y).toEqual(expect.any(Number));
  1587 |   expect(updates.x).not.toBe(before?.x);
  1588 |   expect(updates.y).not.toBe(before?.y);
  1589 |   await expect.poll(() => api.requests.filter((candidate) => candidate.method() === 'PATCH').length).toBeGreaterThan(0);
  1590 |   expect(api.requests.filter((candidate) => candidate.method() === 'PATCH').map((candidate) => candidate.postDataJSON())).toContainEqual(updates);
  1591 | 
  1592 |   await page.reload();
  1593 |   await expect(page.getByTestId('node-ppr-process-work')).toBeVisible();
  1594 |   expect(api.requests.filter((candidate) => candidate.method() === 'GET')).toHaveLength(2);
  1595 | });
  1596 | 
  1597 | test('notifies and refreshes the model when an element update fails', async ({ page }) => {
  1598 |   await openModel(page, initialModel, ['PATCH /api/model/elements/product-input']);
  1599 | 
  1600 |   await page.getByTestId('node-ppr-product-input').click();
  1601 |   await page.locator('#name').fill('Rejected update');
  1602 | 
  1603 |   await expect(page.getByText('Could not save this element')).toBeVisible();
  1604 |   await expect(page.getByTestId('node-ppr-product-input')).toBeVisible();
  1605 | 
  1606 |   await page.reload();
```