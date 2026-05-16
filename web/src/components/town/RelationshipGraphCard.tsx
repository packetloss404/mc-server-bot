'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  api,
  type TownDTO,
  type TownRelationshipGraphEdgeDTO,
} from '@/lib/api';

/**
 * Phase 7 — Town Relationship Graph card.
 *
 * Renders the inter-town diplomacy graph as a circular SVG layout. Nodes are
 * sized by the town's population (capped so a runaway founding settlement
 * doesn't crowd the canvas), edges coloured by state:
 *
 *   green  = allied
 *   red    = rival
 *   gray   = neutral
 *
 * Polls /api/relationships every 30s and /api/towns every 30s so node labels
 * + sizes stay in sync. P7-A owns the relationships endpoint shape; we
 * gracefully degrade to a "no relationships yet" empty state when the
 * endpoint 404s, returns the legacy bot-affinity payload, or returns an
 * empty edge list.
 *
 * The layout is a deterministic ring keyed on the active town id (when
 * provided) — the active town pins to angle 0 so the graph doesn't shuffle
 * every render. Force-directed was deemed overkill per the brief.
 */
interface Props {
  /** When set, the active town is pinned to the top of the ring + highlighted. */
  activeTownId?: string | null;
}

const POLL_MS = 30_000;
const STATE_COLORS: Record<'allied' | 'rival' | 'neutral', string> = {
  allied: '#10B981',  // emerald-500
  rival: '#EF4444',   // red-500
  neutral: '#52525B', // zinc-600
};

interface GraphNode {
  id: string;
  name: string;
  population: number;
  tier: TownDTO['tier'];
  cx: number;
  cy: number;
  radius: number;
}

interface GraphEdge {
  key: string;
  fromId: string;
  toId: string;
  state: 'allied' | 'rival' | 'neutral';
  trust: number;
  lastInteractionAt: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const SVG_SIZE = 360;
const RING_RADIUS = 130;
const NODE_MIN_R = 12;
const NODE_MAX_R = 26;

/**
 * Detect the legacy `/api/relationships` payload shape (bot affinity map)
 * and treat it as no town relationships rather than crashing on a malformed
 * type. The fetcher already wraps errors in `{ edges: [] }`, but a
 * successful 200 with the wrong shape is the real risk during P7-A's
 * partial-merge window.
 */
function isLegacyAffinityShape(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const r = (payload as { relationships?: unknown }).relationships;
  if (!r) return false;
  // Legacy: { relationships: { botName: { otherName: number } } }
  return typeof r === 'object' && !Array.isArray(r);
}

export function RelationshipGraphCard({ activeTownId = null }: Props) {
  const [edges, setEdges] = useState<TownRelationshipGraphEdgeDTO[]>([]);
  const [towns, setTowns] = useState<TownDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [graph, list] = await Promise.all([
          // We own the call — manually probe so we can detect the legacy
          // payload shape without crashing on it.
          fetch(`${API_BASE_OR_FALLBACK()}/api/town-relationships`, {
            credentials: 'include',
          })
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status}`))))
            .catch(() => null),
          api.listTowns(),
        ]);
        if (cancelled) return;
        if (graph && !isLegacyAffinityShape(graph)) {
          // Accept either `{ edges: [...] }` (P7-A's spec) or `{ relationships: [...] }`
          // (alternate naming) — first non-empty list wins.
          const candidate =
            (graph as { edges?: TownRelationshipGraphEdgeDTO[] }).edges ??
            (graph as { relationships?: TownRelationshipGraphEdgeDTO[] }).relationships ??
            [];
          setEdges(Array.isArray(candidate) ? candidate : []);
        } else {
          setEdges([]);
        }
        setTowns(list.towns);
      } catch {
        // Silent — render empty state.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const nodes: GraphNode[] = useMemo(
    () => buildNodeRing(towns, activeTownId),
    [towns, activeTownId],
  );

  const renderEdges: GraphEdge[] = useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const out: GraphEdge[] = [];
    for (const e of edges) {
      const a = nodeById.get(e.townIdA);
      const b = nodeById.get(e.townIdB);
      if (!a || !b) continue;
      const state: 'allied' | 'rival' | 'neutral' =
        e.state === 'allied' || e.state === 'rival' ? e.state : 'neutral';
      out.push({
        key: `${e.townIdA}::${e.townIdB}`,
        fromId: e.townIdA,
        toId: e.townIdB,
        state,
        trust: e.trust,
        lastInteractionAt: e.lastInteractionAt,
        x1: a.cx,
        y1: a.cy,
        x2: b.cx,
        y2: b.cy,
      });
    }
    return out;
  }, [edges, nodes]);

  const hoverEdge = useMemo(
    () => renderEdges.find((e) => e.key === hoverEdgeKey) ?? null,
    [renderEdges, hoverEdgeKey],
  );
  const hoverNode = useMemo(
    () => nodes.find((n) => n.id === hoverNodeId) ?? null,
    [nodes, hoverNodeId],
  );

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Inter-Town Relationships</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">30s poll</span>
      </header>
      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-10 text-xs text-zinc-500">Loading relationships…</div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-10 text-xs text-zinc-500">
            No towns yet. Found a second town to start populating the diplomacy graph.
          </div>
        ) : (
          <div className="flex gap-4 items-start flex-wrap">
            <div className="relative shrink-0">
              <svg
                width={SVG_SIZE}
                height={SVG_SIZE}
                viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
                className="block"
                role="img"
                aria-label="Inter-town relationship graph"
              >
                {/* Edges drawn first so nodes overpaint endpoints. */}
                {renderEdges.map((e) => (
                  <line
                    key={e.key}
                    x1={e.x1}
                    y1={e.y1}
                    x2={e.x2}
                    y2={e.y2}
                    stroke={STATE_COLORS[e.state]}
                    strokeWidth={hoverEdgeKey === e.key ? 4 : 2}
                    strokeOpacity={hoverEdgeKey === e.key ? 0.95 : 0.55}
                    onMouseEnter={() => setHoverEdgeKey(e.key)}
                    onMouseLeave={() =>
                      setHoverEdgeKey((cur) => (cur === e.key ? null : cur))
                    }
                    style={{ cursor: 'pointer' }}
                  />
                ))}
                {/* Nodes */}
                {nodes.map((n) => {
                  const isActive = activeTownId === n.id;
                  const isHover = hoverNodeId === n.id;
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.cx} ${n.cy})`}
                      onMouseEnter={() => setHoverNodeId(n.id)}
                      onMouseLeave={() =>
                        setHoverNodeId((cur) => (cur === n.id ? null : cur))
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <circle
                        r={n.radius}
                        fill={isActive ? '#F59E0B' : '#27272A'}
                        stroke={isHover ? '#FCD34D' : isActive ? '#FCD34D' : '#52525B'}
                        strokeWidth={isHover || isActive ? 2 : 1.5}
                      />
                      <text
                        y={n.radius + 12}
                        textAnchor="middle"
                        fontSize={10}
                        fill={isActive ? '#FCD34D' : '#D4D4D8'}
                        fontWeight={isActive ? 700 : 500}
                      >
                        {truncate(n.name, 16)}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Right pane: legend + hover detail */}
            <div className="flex-1 min-w-[200px] space-y-3">
              <Legend />
              <div className="bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-3 min-h-[140px]">
                {hoverEdge ? (
                  <EdgeDetail
                    edge={hoverEdge}
                    fromName={nodes.find((n) => n.id === hoverEdge.fromId)?.name ?? hoverEdge.fromId}
                    toName={nodes.find((n) => n.id === hoverEdge.toId)?.name ?? hoverEdge.toId}
                  />
                ) : hoverNode ? (
                  <NodeDetail node={hoverNode} />
                ) : (
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Hover an edge to see trust + last interaction. Hover a node for tier and
                    population.
                    {edges.length === 0 && (
                      <span className="block mt-2 text-zinc-600">
                        No diplomatic relationships have formed yet — every pair defaults to
                        neutral until something happens between them.
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {(['allied', 'neutral', 'rival'] as const).map((state) => (
        <div key={state} className="flex items-center gap-1.5">
          <span
            className="w-3 h-0.5 rounded"
            style={{ backgroundColor: STATE_COLORS[state] }}
            aria-hidden
          />
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
            {state}
          </span>
        </div>
      ))}
    </div>
  );
}

function EdgeDetail({
  edge,
  fromName,
  toName,
}: {
  edge: GraphEdge;
  fromName: string;
  toName: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: `${STATE_COLORS[edge.state]}20`,
            color: STATE_COLORS[edge.state],
            border: `1px solid ${STATE_COLORS[edge.state]}40`,
          }}
        >
          {edge.state}
        </span>
        <span className="text-[10px] text-zinc-500">trust {Math.round(edge.trust)}</span>
      </div>
      <div className="text-xs text-zinc-200 font-semibold truncate">
        {fromName} ↔ {toName}
      </div>
      <div className="text-[10px] text-zinc-500">
        last interaction: {edge.lastInteractionAt ? timeAgo(edge.lastInteractionAt) : '—'}
      </div>
    </div>
  );
}

function NodeDetail({ node }: { node: GraphNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-bold text-amber-300 truncate">{node.name}</div>
      <div className="flex items-center gap-2 text-[10px] text-zinc-400">
        <span className="uppercase tracking-wider">{node.tier}</span>
        <span>·</span>
        <span>
          pop {node.population} resident{node.population === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

function buildNodeRing(towns: TownDTO[], activeTownId: string | null): GraphNode[] {
  if (towns.length === 0) return [];
  const center = SVG_SIZE / 2;
  // Pin the active town to angle = -π/2 (top of the ring) so the layout
  // doesn't reshuffle every render. When no active town is provided we
  // still order by name for determinism.
  const ordered = [...towns].sort((a, b) => a.name.localeCompare(b.name));
  const pinIdx = activeTownId ? ordered.findIndex((t) => t.id === activeTownId) : -1;
  if (pinIdx > 0) {
    const [pin] = ordered.splice(pinIdx, 1);
    ordered.unshift(pin);
  }
  const maxPop = Math.max(1, ...ordered.map((t) => t.population));
  return ordered.map((t, i) => {
    if (ordered.length === 1) {
      return {
        id: t.id,
        name: t.name,
        population: t.population,
        tier: t.tier,
        cx: center,
        cy: center,
        radius: nodeRadiusFor(t.population, maxPop),
      };
    }
    const angle = -Math.PI / 2 + (i / ordered.length) * Math.PI * 2;
    return {
      id: t.id,
      name: t.name,
      population: t.population,
      tier: t.tier,
      cx: center + RING_RADIUS * Math.cos(angle),
      cy: center + RING_RADIUS * Math.sin(angle),
      radius: nodeRadiusFor(t.population, maxPop),
    };
  });
}

function nodeRadiusFor(pop: number, maxPop: number): number {
  if (maxPop <= 0) return NODE_MIN_R;
  const t = Math.min(1, pop / maxPop);
  return NODE_MIN_R + (NODE_MAX_R - NODE_MIN_R) * t;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Resolve the same API base the rest of the dashboard uses without
 * importing the private constant. Falls back to localhost so the SSR
 * type-check happy-path doesn't blow up if the env is unset.
 */
function API_BASE_OR_FALLBACK(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

export default RelationshipGraphCard;
