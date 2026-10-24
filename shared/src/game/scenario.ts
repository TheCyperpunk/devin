// Scenario loading and the ward graph: validation with referential checks, adjacency, shortest paths (BFS),
// nearest place to unload. Everything is deterministic (neighbours are sorted by id).
import { ScenarioSchema, type Scenario, type ScenarioNode } from './contract.js';

export function parseScenario(raw: unknown): Scenario {
  const scn = ScenarioSchema.parse(raw);
  const ids = new Set(scn.nodes.map((n) => n.id));
  if (ids.size !== scn.nodes.length) throw new Error('scenario: duplicate node id');
  if (!ids.has(scn.startNodeId)) throw new Error('scenario: startNodeId is not a node');
  for (const [a, b] of scn.edges) {
    if (!ids.has(a) || !ids.has(b)) throw new Error(`scenario: edge ${a}-${b} names an unknown node`);
    if (a === b) throw new Error(`scenario: edge ${a}-${a} loops`);
  }
  for (const c of scn.calls) {
    if (!ids.has(c.nodeId)) throw new Error(`scenario: call at unknown node ${c.nodeId}`);
    if (c.round > scn.rounds) throw new Error(`scenario: call in round ${c.round} after the last round`);
  }
  if (!scn.nodes.some((n) => n.kind === 'camp')) throw new Error('scenario: needs a camp');
  const ward = new Ward(scn);
  for (const n of scn.nodes) {
    if (ward.shortestPath(scn.startNodeId, n.id) === null) throw new Error(`scenario: ${n.id} cannot be reached from the start`);
  }
  return scn;
}

const rank = (kind: ScenarioNode['kind']) => (kind === 'camp' ? 0 : kind === 'hospital' ? 1 : 2);

export class Ward {
  private nodes = new Map<string, ScenarioNode>();
  private adj = new Map<string, string[]>();
  private paths = new Map<string, Map<string, string[]>>();
  readonly unloadNodes: string[];

  constructor(readonly scenario: Scenario) {
    for (const n of scenario.nodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    for (const [a, b] of scenario.edges) {
      this.adj.get(a)?.push(b);
      this.adj.get(b)?.push(a);
    }
    for (const list of this.adj.values()) list.sort();
    // Anywhere people are safe: the camp, the hospital, and shelters marked safe (temple, school).
    this.unloadNodes = scenario.nodes
      .filter((n) => n.kind === 'camp' || n.kind === 'hospital' || n.safe)
      .sort((a, b) => rank(a.kind) - rank(b.kind) || a.id.localeCompare(b.id))
      .map((n) => n.id);
  }

  node(id: string): ScenarioNode | undefined {
    return this.nodes.get(id);
  }

  neighbours(id: string): readonly string[] {
    return this.adj.get(id) ?? [];
  }

  isAdjacent(a: string, b: string): boolean {
    return this.neighbours(a).includes(b);
  }

  /** Can the water reach people here? Houses only, never a node marked safe. */
  canFlood(id: string): boolean {
    const n = this.nodes.get(id);
    return !!n && n.kind === 'house' && !n.safe;
  }

  /** Nodes after `from`, ending with `to`; [] when from === to; null when unreachable. */
  shortestPath(from: string, to: string): string[] | null {
    let fromPaths = this.paths.get(from);
    if (!fromPaths) {
      fromPaths = this.bfs(from);
      this.paths.set(from, fromPaths);
    }
    return fromPaths.get(to) ?? null;
  }

  distance(from: string, to: string): number {
    const p = this.shortestPath(from, to);
    return p === null ? Number.POSITIVE_INFINITY : p.length;
  }

  /**
   * Nearest place to unload (camp, hospital or a safe shelter); ties go camp > hospital > shelter.
   * With `preferHospital`, the hospital wins when it is at most one step farther than the nearest other place.
   */
  nearestUnload(from: string, preferHospital: boolean): string | null {
    const pick = (ids: readonly string[]) => {
      let best: string | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      for (const id of ids) {
        const d = this.distance(from, id);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return { best, d: bestD };
    };
    const any = pick(this.unloadNodes);
    if (preferHospital) {
      const h = pick(this.unloadNodes.filter((id) => this.nodes.get(id)?.kind === 'hospital'));
      if (h.best !== null && h.d <= any.d + 1) return h.best;
    }
    return any.best;
  }

  private bfs(from: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (!this.nodes.has(from)) return out;
    out.set(from, []);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      const path = out.get(cur)!;
      for (const next of this.neighbours(cur)) {
        if (out.has(next)) continue;
        out.set(next, [...path, next]);
        queue.push(next);
      }
    }
    return out;
  }
}
