import type { PprElement, PprModel } from '@workspace/api-client-react';
import {
  getProcessSpecification,
  type ProcessSpecificationFlow,
  type ProcessSpecificationProcessNode,
  type ProcessSpecificationProjection,
  type ProcessSpecificationProduct,
} from './process-specification-utils';

const PAGE_WIDTH = 1480;
const PAGE_PADDING = 48;
const CARD_WIDTH = 286;
const CARD_GAP = 24;
const ROW_GAP = 38;
const FONT_SANS = 'Arial, Helvetica, sans-serif';
const FONT_MONO = "'Courier New', Courier, monospace";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeText(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function wrapText(value: string, maxCharacters: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && next.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function text(
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    weight?: number;
    fill?: string;
    family?: string;
    anchor?: 'start' | 'middle' | 'end';
    letterSpacing?: number;
  } = {},
): string {
  const {
    size = 14,
    weight = 400,
    fill = '#243447',
    family = FONT_SANS,
    anchor = 'start',
    letterSpacing = 0,
  } = options;
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="${family}" font-size="${size}px" font-weight="${weight}" text-anchor="${anchor}"${letterSpacing ? ` letter-spacing="${letterSpacing}px"` : ''}>${escapeXml(value)}</text>`;
}

function multiline(
  value: string,
  x: number,
  y: number,
  maxCharacters: number,
  options: Parameters<typeof text>[3] = {},
  lineHeight = 16,
): string {
  return wrapText(value, maxCharacters)
    .slice(0, 2)
    .map((line, index) => text(line, x, y + index * lineHeight, options))
    .join('');
}

function elementId(element: PprElement): string {
  return element.id.slice(0, 8);
}

function productName(product: PprElement): string {
  return safeText(product.name, 'Unnamed product');
}

function processName(process: PprElement): string {
  return safeText(process.name, 'Unnamed process');
}

function productListHeight(products: PprElement[]): number {
  return products.length === 0 ? 0 : 27 + products.length * 20;
}

function nodeHeight(node: ProcessSpecificationProcessNode): number {
  const descriptionHeight = node.process.description?.trim() ? 18 : 0;
  const childrenHeight = node.isCycle || node.children.length === 0
    ? 0
    : 28 + node.children.reduce((total, child) => total + nodeHeight(child), 0) + (node.children.length - 1) * 10;
  return 78
    + descriptionHeight
    + productListHeight(node.inputs)
    + productListHeight(node.outputs)
    + (node.isCycle ? 48 : 0)
    + childrenHeight
    + 16;
}

function roleColor(role: ProcessSpecificationProduct['role']): string {
  return role === 'boundary' ? '#0f766e' : '#1f7a75';
}

function productPill(
  product: PprElement,
  x: number,
  y: number,
  width: number,
  role?: ProcessSpecificationProduct['role'],
): string {
  const label = productName(product);
  const maxCharacters = Math.max(12, Math.floor(width / 8));
  const displayLabel = label.length > maxCharacters
    ? `${label.slice(0, maxCharacters - 1)}…`
    : label;
  const color = role ? roleColor(role) : '#1f7a75';
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="22" fill="#f1f8f7" stroke="${color}" stroke-width="1"/>`,
    `<title>${escapeXml(label)} (${escapeXml(elementId(product))})</title>`,
    text(displayLabel, x + 9, y + 15, { size: 11, weight: 600, fill: '#155e59' }),
    text(elementId(product), x + width - 8, y + 15, {
      size: 8,
      family: FONT_MONO,
      fill: '#56817d',
      anchor: 'end',
    }),
  ].join('');
}

function renderProductSection(
  label: string,
  products: PprElement[],
  x: number,
  y: number,
  width: number,
): string {
  if (products.length === 0) return '';
  let markup = text(label, x, y + 11, {
    size: 9,
    weight: 700,
    family: FONT_MONO,
    fill: '#667786',
    letterSpacing: 1.2,
  });
  products.forEach((product, index) => {
    markup += productPill(product, x, y + 18 + index * 20, width, undefined);
  });
  return markup;
}

function renderNode(
  node: ProcessSpecificationProcessNode,
  x: number,
  y: number,
  width: number,
  nested = false,
): string {
  const height = nodeHeight(node);
  const process = node.process;
  const description = process.description?.trim();
  let cursor = y + 67;
  let markup = `<g data-process-id="${escapeXml(process.id)}">`;
  markup += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${nested ? '#fbfcfc' : '#ffffff'}" stroke="${nested ? '#9aa9ad' : '#334e5c'}" stroke-width="${nested ? 1 : 1.5}"/>`;
  markup += `<rect x="${x}" y="${y}" width="${width}" height="7" fill="#294f70"/>`;
  markup += text(nested ? 'CONTAINED OPERATION' : 'PROCESS STAGE', x + 14, y + 25, {
    size: 9,
    weight: 700,
    family: FONT_MONO,
    fill: '#667786',
    letterSpacing: 1,
  });
  markup += text(processName(process), x + 14, y + 45, {
    size: 16,
    weight: 700,
    fill: '#1e3a4a',
  });
  markup += text(elementId(process), x + width - 14, y + 25, {
    size: 8,
    family: FONT_MONO,
    fill: '#71818b',
    anchor: 'end',
  });
  if (description) {
    markup += multiline(description, x + 14, y + 62, 38, { size: 10, fill: '#667786' }, 13);
    cursor += 18;
  }
  if (node.inputs.length > 0) {
    markup += renderProductSection('INPUTS', node.inputs, x + 14, cursor, width - 28);
    cursor += productListHeight(node.inputs);
  }
  if (node.outputs.length > 0) {
    markup += renderProductSection('OUTPUTS', node.outputs, x + 14, cursor, width - 28);
    cursor += productListHeight(node.outputs);
  }
  if (node.isCycle) {
    markup += `<rect x="${x + 14}" y="${cursor}" width="${width - 28}" height="38" fill="#fff7ed" stroke="#c2410c" stroke-width="1"/>`;
    markup += text('CYCLE BOUNDARY', x + 24, cursor + 15, {
      size: 10,
      weight: 700,
      family: FONT_MONO,
      fill: '#c2410c',
      letterSpacing: 1,
    });
    markup += text('RECURSION HALTED AT THIS OPERATION', x + 24, cursor + 29, {
      size: 8,
      family: FONT_MONO,
      fill: '#8b6a52',
      letterSpacing: 0.5,
    });
    cursor += 48;
  } else if (node.children.length > 0) {
    markup += text('CONTAINED SUBPROCESSES', x + 14, cursor + 12, {
      size: 9,
      weight: 700,
      family: FONT_MONO,
      fill: '#667786',
      letterSpacing: 1.1,
    });
    cursor += 28;
    node.children.forEach((child, index) => {
      markup += renderNode(child, x + 14, cursor, width - 28, true);
      cursor += nodeHeight(child) + (index < node.children.length - 1 ? 10 : 0);
    });
  }
  markup += '</g>';
  return markup;
}

function flowLabel(flow: ProcessSpecificationFlow, projection: ProcessSpecificationProjection): string {
  if (flow.kind === 'direct') return 'DIRECT FLOW';
  const product = projection.products.find((item) => item.product.id === flow.productId);
  return product ? `MATERIAL BRIDGE · ${productName(product.product)}` : 'MATERIAL BRIDGE';
}

function renderFlow(
  flow: ProcessSpecificationFlow,
  projection: ProcessSpecificationProjection,
  x: number,
  y: number,
  width: number,
): string {
  const processById = new Map(projection.processes.map((process) => [process.id, process]));
  const source = processById.get(flow.sourceProcessId);
  const target = processById.get(flow.targetProcessId);
  if (!source || !target) return '';
  const leftWidth = Math.min(220, Math.max(150, width * 0.22));
  const rightX = x + width - leftWidth;
  const middleX = x + leftWidth + 22;
  const middleWidth = rightX - middleX - 22;
  let markup = `<g data-flow-id="${escapeXml(flow.id)}">`;
  markup += `<rect x="${x}" y="${y}" width="${width}" height="48" fill="#f7f9f9" stroke="#c8d3d6" stroke-dasharray="5 4"/>`;
  markup += text(processName(source), x + 12, y + 20, { size: 12, weight: 700, fill: '#1e3a4a' });
  markup += text('SOURCE STAGE', x + 12, y + 35, { size: 8, family: FONT_MONO, fill: '#71818b', letterSpacing: 0.8 });
  markup += `<line x1="${middleX}" y1="${y + 24}" x2="${middleX + middleWidth}" y2="${y + 24}" stroke="#81939a" stroke-width="1.5"/>`;
  markup += `<polygon points="${middleX + middleWidth},${y + 24} ${middleX + middleWidth - 8},${y + 19} ${middleX + middleWidth - 8},${y + 29}" fill="#294f70"/>`;
  markup += text(flowLabel(flow, projection), x + width / 2, y + 18, {
    size: 9,
    weight: 700,
    family: FONT_MONO,
    fill: flow.kind === 'product' ? '#0f766e' : '#667786',
    anchor: 'middle',
    letterSpacing: 0.6,
  });
  markup += text(flow.relationshipIds.length === 1 ? '1 relationship' : `${flow.relationshipIds.length} relationships`, x + width / 2, y + 35, {
    size: 8,
    family: FONT_MONO,
    fill: '#88979d',
    anchor: 'middle',
  });
  markup += text(processName(target), rightX + 12, y + 20, { size: 12, weight: 700, fill: '#1e3a4a' });
  markup += text('TARGET STAGE', rightX + 12, y + 35, { size: 8, family: FONT_MONO, fill: '#71818b', letterSpacing: 0.8 });
  markup += '</g>';
  return markup;
}

function renderProductRail(
  title: string,
  products: ProcessSpecificationProduct[],
  x: number,
  y: number,
  width: number,
  emptyText: string,
): string {
  const columns = Math.max(1, Math.floor(width / 270));
  const rows = Math.max(1, Math.ceil(products.length / columns));
  const height = products.length === 0 ? 55 : 38 + rows * 32;
  let markup = `<g data-product-rail="${escapeXml(title)}">`;
  markup += `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff" stroke="#c8d3d6"/>`;
  markup += text(title, x + 16, y + 22, {
    size: 10,
    weight: 700,
    family: FONT_MONO,
    fill: '#667786',
    letterSpacing: 1.2,
  });
  markup += text(products.length.toString().padStart(2, '0'), x + width - 16, y + 22, {
    size: 10,
    family: FONT_MONO,
    fill: '#0f766e',
    anchor: 'end',
  });
  if (products.length === 0) {
    markup += text(emptyText, x + 16, y + 43, { size: 11, fill: '#88979d' });
  } else {
    products.forEach((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      markup += productPill(item.product, x + 16 + column * 270, y + 30 + row * 32, 252, item.role);
    });
  }
  return `${markup}</g>`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'ppr-model';
}

export function getProcessSpecificationFilename(model: PprModel): string {
  return `${slugify(model.name)}-process-specification.svg`;
}

export function getProcessSpecificationSvg(
  model: PprModel,
  projection = getProcessSpecification(model),
): string {
  const widestStageRow = Math.max(1, ...projection.rows.map((row) => row.processes.length));
  const pageWidth = Math.max(
    PAGE_WIDTH,
    PAGE_PADDING * 2 + widestStageRow * CARD_WIDTH + (widestStageRow - 1) * CARD_GAP,
  );
  const contentWidth = pageWidth - PAGE_PADDING * 2;
  const externalRows = Math.max(1, Math.ceil(projection.externalProducts.length / 4));
  const externalHeight = projection.externalProducts.length > 0
    ? Math.max(102, 72 + (externalRows - 1) * 30)
    : 74;
  let cursor = 132;
  let markup = '';

  markup += text('PROCESS SPECIFICATION / READ ONLY', PAGE_PADDING, 42, {
    size: 10,
    weight: 700,
    family: FONT_MONO,
    fill: '#0f766e',
    letterSpacing: 1.6,
  });
  markup += text(safeText(model.name, 'Untitled PPR model'), PAGE_PADDING, 78, {
    size: 30,
    weight: 700,
    fill: '#1e3a4a',
  });
  markup += text('PRODUCTION FLOW · DERIVED FROM GRAPH RELATIONSHIPS', PAGE_PADDING, 101, {
    size: 10,
    weight: 700,
    family: FONT_MONO,
    fill: '#667786',
    letterSpacing: 1,
  });
  markup += text(
    `${projection.processes.length} processes · ${projection.products.length} products · ${projection.flows.length} handoffs`,
    pageWidth - PAGE_PADDING,
    42,
    { size: 10, family: FONT_MONO, fill: '#667786', anchor: 'end' },
  );
  markup += `<line x1="${PAGE_PADDING}" y1="116" x2="${pageWidth - PAGE_PADDING}" y2="116" stroke="#294f70" stroke-width="2"/>`;

  markup += `<g data-section="external-inputs"><rect x="${PAGE_PADDING}" y="${cursor}" width="${contentWidth}" height="${externalHeight}" fill="#f7f9f9" stroke="#c8d3d6"/>`;
  markup += text('EXTERNAL INPUTS', PAGE_PADDING + 16, cursor + 23, {
    size: 10,
    weight: 700,
    family: FONT_MONO,
    fill: '#0f766e',
    letterSpacing: 1.2,
  });
  if (projection.externalProducts.length === 0) {
    markup += text('No external feeds derived', PAGE_PADDING + 16, cursor + 48, { size: 12, fill: '#88979d' });
  } else {
    projection.externalProducts.forEach((item, index) => {
      const x = PAGE_PADDING + 16 + (index % 4) * 340;
      const y = cursor + 34 + Math.floor(index / 4) * 30;
      markup += productPill(item.product, x, y, 310, item.role);
    });
  }
  markup += '</g>';
  cursor += externalHeight + 24;

  if (projection.rows.length === 0) {
    markup += `<rect x="${PAGE_PADDING}" y="${cursor}" width="${contentWidth}" height="92" fill="#ffffff" stroke="#c8d3d6" stroke-dasharray="6 4"/>`;
    markup += text('NO PROCESS STAGES TO DRAW', pageWidth / 2, cursor + 39, {
      size: 14,
      weight: 700,
      family: FONT_MONO,
      fill: '#667786',
      anchor: 'middle',
      letterSpacing: 1,
    });
    markup += text('Add process elements and graph relationships to generate a process specification.', pageWidth / 2, cursor + 62, {
      size: 11,
      fill: '#88979d',
      anchor: 'middle',
    });
    cursor += 116;
  } else {
    const rootRankByProcessId = new Map<string, number>();
    projection.rows.forEach((row) => row.processes.forEach((node) => rootRankByProcessId.set(node.process.id, row.rank)));
    for (const row of projection.rows) {
      const rowHeight = Math.max(...row.processes.map(nodeHeight));
      markup += text(`DEPTH BAND ${String(row.rank + 1).padStart(2, '0')}`, PAGE_PADDING, cursor + 16, {
        size: 10,
        weight: 700,
        family: FONT_MONO,
        fill: '#667786',
        letterSpacing: 1.2,
      });
      markup += text(
        `${row.processes.length} parallel stage${row.processes.length === 1 ? '' : 's'}`,
        pageWidth - PAGE_PADDING,
        cursor + 16,
        { size: 10, family: FONT_MONO, fill: '#88979d', anchor: 'end' },
      );
      cursor += 28;
      row.processes.forEach((node, index) => {
        markup += renderNode(node, PAGE_PADDING + index * (CARD_WIDTH + CARD_GAP), cursor, CARD_WIDTH);
      });
      cursor += rowHeight;
      const flows = projection.flows.filter((flow) => (rootRankByProcessId.get(flow.sourceProcessId) ?? 0) === row.rank);
      if (flows.length > 0) {
        cursor += 12;
        flows.forEach((flow) => {
          markup += renderFlow(flow, projection, PAGE_PADDING, cursor, contentWidth);
          cursor += 58;
        });
      }
      cursor += ROW_GAP;
    }
  }

  const railWidth = (contentWidth - 18) / 2;
  markup += renderProductRail('TERMINAL OUTPUTS', projection.terminalOutputs, PAGE_PADDING, cursor, railWidth, 'No terminal outputs derived');
  markup += renderProductRail('STANDALONE PRODUCTS', projection.standaloneProducts, PAGE_PADDING + railWidth + 18, cursor, railWidth, 'No standalone products derived');
  cursor += Math.max(
    projection.terminalOutputs.length === 0 ? 55 : 38 + Math.ceil(projection.terminalOutputs.length / Math.max(1, Math.floor(railWidth / 270))) * 32,
    projection.standaloneProducts.length === 0 ? 55 : 38 + Math.ceil(projection.standaloneProducts.length / Math.max(1, Math.floor(railWidth / 270))) * 32,
  ) + 34;

  const cycleCount = projection.cycleProcessIds.size;
  markup += `<line x1="${PAGE_PADDING}" y1="${cursor}" x2="${pageWidth - PAGE_PADDING}" y2="${cursor}" stroke="#c8d3d6"/>`;
  markup += text(
    cycleCount > 0
      ? `WARNING · ${cycleCount} cycle marker${cycleCount === 1 ? '' : 's'} preserved from the process projection`
      : 'No cycle boundaries detected in the process projection',
    PAGE_PADDING,
    cursor + 23,
    { size: 10, family: FONT_MONO, fill: cycleCount > 0 ? '#c2410c' : '#667786', letterSpacing: 0.5 },
  );
  markup += text('PPR ENGINEERING MODEL', pageWidth - PAGE_PADDING, cursor + 23, {
    size: 9,
    family: FONT_MONO,
    fill: '#88979d',
    anchor: 'end',
    letterSpacing: 0.8,
  });
  cursor += 46;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${cursor}" viewBox="0 0 ${pageWidth} ${cursor}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(safeText(model.name, 'Untitled PPR model'))} — Process Specification</title>
  <desc id="description">A deterministic engineering drawing of the production flow, including process stages, material bridges, boundary products, external inputs, terminal outputs, nested subprocesses, and cycle warnings.</desc>
  <rect width="100%" height="100%" fill="#f4f7f7"/>
  <rect x="18" y="18" width="${pageWidth - 36}" height="${cursor - 36}" fill="#ffffff" stroke="#9aa9ad"/>
  ${markup}
</svg>`;
}