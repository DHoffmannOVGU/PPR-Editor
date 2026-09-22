import type { PprElement, PprModel, PprRelationship } from '@workspace/api-client-react';
import { getModelRelationships, getModelUsages } from './analysis-utils';

export type ProcessSpecificationProductRole =
  | 'external-input'
  | 'boundary'
  | 'terminal-output'
  | 'standalone';

export type ProcessSpecificationProduct = {
  product: PprElement;
  role: ProcessSpecificationProductRole;
  upstreamProcessIds: string[];
  downstreamProcessIds: string[];
  relationshipIds: string[];
};

export type ProcessSpecificationProcessNode = {
  process: PprElement;
  inputs: PprElement[];
  outputs: PprElement[];
  children: ProcessSpecificationProcessNode[];
  isCycle: boolean;
};

export type ProcessSpecificationFlow = {
  id: string;
  sourceProcessId: string;
  targetProcessId: string;
  kind: 'product' | 'direct';
  productId?: string;
  relationshipIds: string[];
};

export type ProcessSpecificationRow = {
  rank: number;
  processes: ProcessSpecificationProcessNode[];
};

export type ProcessSpecificationProjection = {
  processes: PprElement[];
  products: ProcessSpecificationProduct[];
  roots: ProcessSpecificationProcessNode[];
  rows: ProcessSpecificationRow[];
  flows: ProcessSpecificationFlow[];
  externalProducts: ProcessSpecificationProduct[];
  boundaryProducts: ProcessSpecificationProduct[];
  terminalOutputs: ProcessSpecificationProduct[];
  standaloneProducts: ProcessSpecificationProduct[];
  cycleProcessIds: Set<string>;
  processRootIds: Map<string, string>;
  nodeByProcessId: Map<string, ProcessSpecificationProcessNode>;
};

type ProcessLink = {
  processId: string;
  relationshipId: string;
};

const processOrder = (processes: PprElement[]) => new Map(processes.map((process, index) => [process.id, index]));

function addLink(map: Map<string, ProcessLink[]>, key: string, link: ProcessLink) {
  const links = map.get(key) ?? [];
  if (!links.some((item) => item.processId === link.processId && item.relationshipId === link.relationshipId)) {
    links.push(link);
  }
  map.set(key, links);
}

function collectCycleIds(
  processIds: string[],
  childrenByProcessId: Map<string, string[]>,
): Set<string> {
  const cycleProcessIds = new Set<string>();
  const visited = new Set<string>();
  const activePath: string[] = [];
  const activeIds = new Set<string>();

  const visit = (processId: string) => {
    if (activeIds.has(processId)) {
      const cycleStart = activePath.indexOf(processId);
      activePath.slice(cycleStart).forEach((id) => cycleProcessIds.add(id));
      return;
    }
    if (visited.has(processId)) return;
    activePath.push(processId);
    activeIds.add(processId);
    (childrenByProcessId.get(processId) ?? []).forEach(visit);
    activePath.pop();
    activeIds.delete(processId);
    visited.add(processId);
  };

  processIds.forEach(visit);
  return cycleProcessIds;
}

function getRootResolver(
  parentIdsByProcessId: Map<string, string[]>,
): (processId: string) => string {
  const memo = new Map<string, string>();

  const findRoot = (processId: string, path: string[]): string => {
    const cached = memo.get(processId);
    if (cached && !path.includes(processId)) return cached;

    if (path.includes(processId)) {
      return [...path.slice(path.indexOf(processId)), processId].sort()[0];
    }

    const parents = parentIdsByProcessId.get(processId) ?? [];
    if (parents.length === 0) {
      memo.set(processId, processId);
      return processId;
    }

    const root = parents
      .map((parentId) => findRoot(parentId, [...path, processId]))
      .sort()[0];
    memo.set(processId, root);
    return root;
  };

  return (processId: string) => findRoot(processId, []);
}

function buildFlowRanks(
  processIds: string[],
  flows: ProcessSpecificationFlow[],
): Map<string, number> {
  const predecessors = new Map<string, Set<string>>();
  processIds.forEach((processId) => predecessors.set(processId, new Set()));
  flows.forEach((flow) => {
    if (flow.sourceProcessId !== flow.targetProcessId) {
      predecessors.get(flow.targetProcessId)?.add(flow.sourceProcessId);
    }
  });

  const ranks = new Map<string, number>();
  const active = new Set<string>();
  const rankFor = (processId: string): number => {
    const cached = ranks.get(processId);
    if (cached !== undefined) return cached;
    if (active.has(processId)) return 0;
    active.add(processId);
    const rank = Math.max(
      0,
      ...(Array.from(predecessors.get(processId) ?? []).map((predecessorId) => rankFor(predecessorId) + 1)),
    );
    active.delete(processId);
    ranks.set(processId, rank);
    return rank;
  };

  processIds.forEach(rankFor);
  return ranks;
}

export function getProcessSpecification(model: PprModel): ProcessSpecificationProjection {
  const processes = getModelUsages(model).filter((element) => element.type === 'process');
  const products = getModelUsages(model).filter((element) => element.type === 'product');
  const byId = new Map(getModelUsages(model).map((element) => [element.id, element]));
  const order = processOrder(processes);
  const processIds = new Set(processes.map((process) => process.id));

  const childrenByProcessId = new Map<string, string[]>();
  const parentIdsByProcessId = new Map<string, string[]>();
  for (const relationship of getModelRelationships(model)) {
    if (relationship.kind !== 'contains') continue;
    const source = byId.get(relationship.source_id);
    const target = byId.get(relationship.target_id);
    if (source?.type !== 'process' || target?.type !== 'process') continue;
    const children = childrenByProcessId.get(source.id) ?? [];
    if (!children.includes(target.id)) children.push(target.id);
    childrenByProcessId.set(source.id, children);
    const parents = parentIdsByProcessId.get(target.id) ?? [];
    if (!parents.includes(source.id)) parents.push(source.id);
    parentIdsByProcessId.set(target.id, parents);
  }

  const cycleProcessIds = collectCycleIds(processes.map((process) => process.id), childrenByProcessId);
  const rootFor = getRootResolver(parentIdsByProcessId);
  const processRootIds = new Map(processes.map((process) => [process.id, rootFor(process.id)]));
  const rootIds: string[] = [];
  for (const process of processes) {
    const rootId = processRootIds.get(process.id) ?? process.id;
    if (!rootIds.includes(rootId)) rootIds.push(rootId);
  }

  const inputsByProcess = new Map<string, PprElement[]>();
  const outputsByProcess = new Map<string, PprElement[]>();
  const producersByProduct = new Map<string, ProcessLink[]>();
  const consumersByProduct = new Map<string, ProcessLink[]>();

  for (const relationship of getModelRelationships(model)) {
    if (relationship.kind === 'produces') {
      const source = byId.get(relationship.source_id);
      const target = byId.get(relationship.target_id);
      if (source?.type !== 'process' || target?.type !== 'product') continue;
      const outputs = outputsByProcess.get(source.id) ?? [];
      if (!outputs.some((element) => element.id === target.id)) outputs.push(target);
      outputsByProcess.set(source.id, outputs);
      addLink(producersByProduct, target.id, { processId: source.id, relationshipId: relationship.id });
    }
    if (relationship.kind === 'consumed_by') {
      const source = byId.get(relationship.source_id);
      const target = byId.get(relationship.target_id);
      if (source?.type !== 'product' || target?.type !== 'process') continue;
      const inputs = inputsByProcess.get(target.id) ?? [];
      if (!inputs.some((element) => element.id === source.id)) inputs.push(source);
      inputsByProcess.set(target.id, inputs);
      addLink(consumersByProduct, source.id, { processId: target.id, relationshipId: relationship.id });
    }
  }

  const specificationProducts: ProcessSpecificationProduct[] = products.map((product) => {
    const producers = producersByProduct.get(product.id) ?? [];
    const consumers = consumersByProduct.get(product.id) ?? [];
    const role: ProcessSpecificationProductRole = producers.length === 0
      ? consumers.length === 0 ? 'standalone' : 'external-input'
      : consumers.length === 0 ? 'terminal-output' : 'boundary';
    return {
      product,
      role,
      upstreamProcessIds: producers.map((link) => link.processId),
      downstreamProcessIds: consumers.map((link) => link.processId),
      relationshipIds: [...producers, ...consumers].map((link) => link.relationshipId),
    };
  });

  const flows: ProcessSpecificationFlow[] = [];
  const flowKeys = new Set<string>();
  const addFlow = (flow: ProcessSpecificationFlow) => {
    if (flowKeys.has(flow.id)) return;
    flowKeys.add(flow.id);
    flows.push(flow);
  };

  for (const product of specificationProducts.filter((item) => item.role === 'boundary')) {
    const producers = producersByProduct.get(product.product.id) ?? [];
    const consumers = consumersByProduct.get(product.product.id) ?? [];
    for (const producer of producers) {
      for (const consumer of consumers) {
        const sourceProcessId = processRootIds.get(producer.processId) ?? producer.processId;
        const targetProcessId = processRootIds.get(consumer.processId) ?? consumer.processId;
        if (sourceProcessId === targetProcessId) continue;
        addFlow({
          id: `product-${product.product.id}-${sourceProcessId}-${targetProcessId}`,
          sourceProcessId,
          targetProcessId,
          productId: product.product.id,
          kind: 'product',
          relationshipIds: [producer.relationshipId, consumer.relationshipId],
        });
      }
    }
  }

  for (const relationship of getModelRelationships(model)) {
    if (relationship.kind !== 'succeeds') continue;
    const source = byId.get(relationship.source_id);
    const target = byId.get(relationship.target_id);
    if (source?.type !== 'process' || target?.type !== 'process') continue;
    const sourceProcessId = processRootIds.get(source.id) ?? source.id;
    const targetProcessId = processRootIds.get(target.id) ?? target.id;
    if (sourceProcessId === targetProcessId) continue;
    addFlow({
      id: `direct-${sourceProcessId}-${targetProcessId}-${relationship.id}`,
      sourceProcessId,
      targetProcessId,
      kind: 'direct',
      relationshipIds: [relationship.id],
    });
  }

  flows.sort((a, b) => {
    const sourceOrder = (order.get(a.sourceProcessId) ?? 0) - (order.get(b.sourceProcessId) ?? 0);
    if (sourceOrder !== 0) return sourceOrder;
    return (order.get(a.targetProcessId) ?? 0) - (order.get(b.targetProcessId) ?? 0);
  });

  const nodeByProcessId = new Map<string, ProcessSpecificationProcessNode>();
  const buildNode = (processId: string, path: Set<string>, depth: number): ProcessSpecificationProcessNode => {
    const process = byId.get(processId);
    if (!process) {
      throw new Error(`Process specification references missing process ${processId}`);
    }
    if (path.has(processId)) {
      return {
        process,
        inputs: inputsByProcess.get(processId) ?? [],
        outputs: outputsByProcess.get(processId) ?? [],
        children: [],
        isCycle: true,
      };
    }
    const existingNode = nodeByProcessId.get(processId);
    if (existingNode) return existingNode;
    const node: ProcessSpecificationProcessNode = {
      process,
      inputs: inputsByProcess.get(processId) ?? [],
      outputs: outputsByProcess.get(processId) ?? [],
      children: [],
      isCycle: cycleProcessIds.has(processId),
    };
    nodeByProcessId.set(processId, node);
    const nextPath = new Set(path);
    nextPath.add(processId);
    node.children = (childrenByProcessId.get(processId) ?? [])
      .slice()
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map((childId) => buildNode(childId, nextPath, depth + 1));
    return node;
  };

  const roots = rootIds.map((rootId) => buildNode(rootId, new Set(), 0));
  const nodeByRootId = new Map(roots.map((node) => [node.process.id, node]));
  const ranks = buildFlowRanks(rootIds, flows);
  const rowsByRank = new Map<number, ProcessSpecificationProcessNode[]>();
  for (const rootId of rootIds) {
    const rank = ranks.get(rootId) ?? 0;
    const row = rowsByRank.get(rank) ?? [];
    const node = nodeByRootId.get(rootId);
    if (node) row.push(node);
    rowsByRank.set(rank, row);
  }
  const rows = [...rowsByRank.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, rowProcesses]) => ({ rank, processes: rowProcesses }));

  return {
    processes,
    products: specificationProducts,
    roots,
    rows,
    flows,
    externalProducts: specificationProducts.filter((item) => item.role === 'external-input'),
    boundaryProducts: specificationProducts.filter((item) => item.role === 'boundary'),
    terminalOutputs: specificationProducts.filter((item) => item.role === 'terminal-output'),
    standaloneProducts: specificationProducts.filter((item) => item.role === 'standalone'),
    cycleProcessIds,
    processRootIds,
    nodeByProcessId,
  };
}
