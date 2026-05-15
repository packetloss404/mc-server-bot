'use client';

// Force-directed layout constants — tweak these to change cluster tightness.
// k_r (repulsion):  Coulomb-like push between every pair of nodes (k_r / d^2).
// k_s (spring):     Hooke pull along edges toward REST_LENGTH.
// k_c (centering):  Gentle drift toward canvas origin so clusters don't fly off.
// damping:          Per-step velocity decay (0.85 = mild friction).
// ITERATIONS:       Number of relaxation steps before we render once.
// REST_LENGTH:      Desired edge length in pixels.
// MIN_DIST:         Epsilon to avoid 1/0 in repulsion at coincident positions.
const K_R = 2000;
const K_S = 0.02;
const K_C = 0.005;
const DAMPING = 0.85;
const ITERATIONS = 300;
const REST_LENGTH = 80;
const MIN_DIST = 0.5;

import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

// Wider shape than what api.ts declares — /api/skills actually returns these fields.
export interface SkillNodeData {
  name: string;
  description?: string | null;
  keywords?: string[];
  quality?: number | null;
  successCount?: number;
  failureCount?: number;
  code: string | null;
}

interface SkillStatsResponse {
  topPerformers?: { name: string; successCount: number; failureCount: number; quality: number | null }[];
  topFailures?: { name: string; successCount: number; failureCount: number; quality: number | null }[];
}

interface Props {
  skills: SkillNodeData[];
}

interface GraphNode {
  id: string;
  label: string;
  short: string;
  x: number;
  y: number;
  r: number;
  successRate: number | null;
  total: number;
  color: string;
  data: SkillNodeData;
}

interface GraphEdge {
  from: string;
  to: string;
}

// Convert "mine_3_oak_logs" -> "mine3OakLogs" (matches the codegen naming we see in /skills).
function toCamel(name: string): string {
  const parts = name.split(/[_\s]+/).filter(Boolean);
  if (parts.length === 0) return name;
  const [first, ...rest] = parts;
  return first.toLowerCase() + rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
}

function classifyColor(successRate: number | null, total: number): string {
  if (total === 0 || successRate === null) return '#71717a'; // zinc-500
  if (successRate > 0.8) return '#22c55e'; // green-500
  if (successRate >= 0.5) return '#f59e0b'; // amber-500
  return '#ef4444'; // red-500
}

function colorLabel(successRate: number | null, total: number): string {
  if (total === 0 || successRate === null) return 'no data';
  if (successRate > 0.8) return 'healthy';
  if (successRate >= 0.5) return 'flaky';
  return 'failing';
}

export function SkillGraph({ skills }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [fullCode, setFullCode] = useState<string | null>(null);
  const [stats, setStats] = useState<SkillStatsResponse | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  // Element that had focus before the drawer opened — restore on close.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Fetch aggregate stats once — used to show top performers list inside the drawer.
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    fetch(`${base}/api/skills/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SkillStatsResponse | null) => {
        if (data) setStats(data);
      })
      .catch(() => {});
  }, []);

  // Build dependency edges + node positions. Memoized so view interactions don't recompute.
  const { nodes, edges, width, height } = useMemo(() => {
    const skillNames = skills.map((s) => s.name);
    const camelToName = new Map<string, string>();
    for (const name of skillNames) {
      camelToName.set(toCamel(name), name);
    }

    const edgesOut: GraphEdge[] = [];
    for (const skill of skills) {
      if (!skill.code) continue;
      // Strip the skill's own top-level function declaration so we don't self-link.
      const ownFn = toCamel(skill.name);
      const body = skill.code.replace(new RegExp(`function\\s+${ownFn}\\s*\\(`), 'function __self(');
      // Match calls like  fooCamelName(   — any identifier followed by an open paren.
      const matches = body.matchAll(/\b([a-z][a-zA-Z0-9_]*)\s*\(/g);
      const seen = new Set<string>();
      for (const m of matches) {
        const callee = m[1];
        if (callee === ownFn) continue;
        if (seen.has(callee)) continue;
        const target = camelToName.get(callee);
        if (target && target !== skill.name) {
          seen.add(callee);
          edgesOut.push({ from: skill.name, to: target });
        }
      }
    }

    // Sort by total invocations desc so the more-used nodes start nearer the center.
    // (They get tiny radial seed positions so the sim has a non-degenerate starting state.)
    const sorted = [...skills].sort((a, b) => {
      const ta = (a.successCount ?? 0) + (a.failureCount ?? 0);
      const tb = (b.successCount ?? 0) + (b.failureCount ?? 0);
      return tb - ta;
    });

    interface SimNode {
      id: string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
    }

    const n = sorted.length;
    // Seed positions on concentric rings — deterministic, not random, so re-renders match.
    const sim: SimNode[] = sorted.map((skill, i) => {
      const total = (skill.successCount ?? 0) + (skill.failureCount ?? 0);
      const r = 14 + Math.min(20, Math.log2(1 + total) * 4);
      const ring = Math.floor(Math.sqrt(i + 1));
      const perRing = Math.max(6, ring * 6);
      const angle = ((i % perRing) / perRing) * Math.PI * 2;
      const radius = ring * REST_LENGTH * 0.9;
      return {
        id: skill.name,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        r,
      };
    });

    const idToIdx = new Map<string, number>();
    sim.forEach((s, i) => idToIdx.set(s.id, i));

    // Pre-filter edges to ones where both endpoints exist (cheaper inner loop).
    const simEdges: { a: number; b: number }[] = [];
    for (const e of edgesOut) {
      const a = idToIdx.get(e.from);
      const b = idToIdx.get(e.to);
      if (a !== undefined && b !== undefined && a !== b) {
        simEdges.push({ a, b });
      }
    }

    // Run a fixed number of iterations. O(n^2) per step is fine up to ~500 nodes.
    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Reset force accumulators (reuse vx/vy as deltas this step? — no, keep velocities).
      const fx = new Float64Array(n);
      const fy = new Float64Array(n);

      // Repulsion: every pair pushes apart by k_r / d^2.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let dx = sim[i].x - sim[j].x;
          let dy = sim[i].y - sim[j].y;
          let distSq = dx * dx + dy * dy;
          if (distSq < MIN_DIST * MIN_DIST) {
            // Nudge a deterministic tiny offset so we don't divide by zero.
            dx = MIN_DIST;
            dy = 0;
            distSq = MIN_DIST * MIN_DIST;
          }
          const dist = Math.sqrt(distSq);
          const force = K_R / distSq;
          const ux = dx / dist;
          const uy = dy / dist;
          fx[i] += ux * force;
          fy[i] += uy * force;
          fx[j] -= ux * force;
          fy[j] -= uy * force;
        }
      }

      // Spring: each edge pulls endpoints by k_s * (dist - rest_length).
      for (const e of simEdges) {
        const a = sim[e.a];
        const b = sim[e.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || MIN_DIST;
        const force = K_S * (dist - REST_LENGTH);
        const ux = dx / dist;
        const uy = dy / dist;
        fx[e.a] += ux * force;
        fy[e.a] += uy * force;
        fx[e.b] -= ux * force;
        fy[e.b] -= uy * force;
      }

      // Centering + integrate.
      for (let i = 0; i < n; i++) {
        fx[i] -= K_C * sim[i].x;
        fy[i] -= K_C * sim[i].y;

        sim[i].vx = (sim[i].vx + fx[i]) * DAMPING;
        sim[i].vy = (sim[i].vy + fy[i]) * DAMPING;
        sim[i].x += sim[i].vx;
        sim[i].y += sim[i].vy;
      }
    }

    const nodesOut: GraphNode[] = sorted.map((skill, i) => {
      const total = (skill.successCount ?? 0) + (skill.failureCount ?? 0);
      const successRate = total > 0 ? (skill.successCount ?? 0) / total : null;
      const s = sim[i];
      return {
        id: skill.name,
        label: skill.name.replace(/_/g, ' '),
        short: skill.name,
        x: s.x,
        y: s.y,
        r: s.r,
        successRate,
        total,
        color: classifyColor(successRate, total),
        data: skill,
      };
    });

    // Compute viewbox bounds with padding.
    const pad = 60;
    const minX = Math.min(...nodesOut.map((nd) => nd.x - nd.r), -pad);
    const maxX = Math.max(...nodesOut.map((nd) => nd.x + nd.r), pad);
    const minY = Math.min(...nodesOut.map((nd) => nd.y - nd.r), -pad);
    const maxY = Math.max(...nodesOut.map((nd) => nd.y + nd.r), pad);
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    // Re-center: shift so minX,minY map to pad,pad.
    const shifted = nodesOut.map((nd) => ({ ...nd, x: nd.x - minX + pad, y: nd.y - minY + pad }));

    return { nodes: shifted, edges: edgesOut, width: w, height: h };
  }, [skills]);

  const nodeIndex = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Edges where both endpoints exist.
  const drawableEdges = useMemo(
    () => edges.filter((e) => nodeIndex.has(e.from) && nodeIndex.has(e.to)),
    [edges, nodeIndex]
  );

  // Selected node lookup.
  const selectedNode = selected ? nodeIndex.get(selected) ?? null : null;

  // Outgoing/incoming edges for the selected node.
  const selectedOutgoing = useMemo(
    () => (selected ? drawableEdges.filter((e) => e.from === selected) : []),
    [drawableEdges, selected]
  );
  const selectedIncoming = useMemo(
    () => (selected ? drawableEdges.filter((e) => e.to === selected) : []),
    [drawableEdges, selected]
  );

  // Lazy-load full code on selection.
  useEffect(() => {
    if (!selected) {
      setFullCode(null);
      return;
    }
    setFullCode(null);
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    let cancelled = false;
    fetch(`${base}/api/skills/${selected}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { code: string } | null) => {
        if (!cancelled) setFullCode(data?.code ?? '// Failed to load code');
      })
      .catch(() => {
        if (!cancelled) setFullCode('// Failed to load code');
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // Drawer focus management: store the previously focused element when the drawer
  // opens, move focus to the close button, and restore focus when it closes.
  useEffect(() => {
    if (selected) {
      previouslyFocusedRef.current =
        (document.activeElement as HTMLElement | null) ?? null;
      // Defer to next tick so the drawer is mounted before we try to focus.
      const id = window.setTimeout(() => {
        if (closeButtonRef.current) {
          closeButtonRef.current.focus();
        } else if (drawerRef.current) {
          const first = drawerRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          first?.focus();
        }
      }, 0);
      return () => {
        window.clearTimeout(id);
      };
    } else {
      // Drawer just closed — restore focus to where it was before opening.
      const prev = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
    }
  }, [selected]);

  // Keydown handler for the drawer container: trap Tab cycling and handle Escape.
  function handleDrawerKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setSelected(null);
      return;
    }
    if (e.key !== 'Tab') return;
    const container = drawerRef.current;
    if (!container) return;
    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Highlight set for hover + selection.
  const highlight = hover ?? selected;
  const highlightNeighbors = useMemo(() => {
    if (!highlight) return new Set<string>();
    const set = new Set<string>([highlight]);
    for (const e of drawableEdges) {
      if (e.from === highlight) set.add(e.to);
      if (e.to === highlight) set.add(e.from);
    }
    return set;
  }, [highlight, drawableEdges]);

  if (skills.length === 0) {
    return (
      <div className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
        <p className="text-sm text-zinc-500">No skills to graph</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500 mb-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#22c55e' }} />
          healthy &gt;80%
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#f59e0b' }} />
          flaky 50-80%
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ef4444' }} />
          failing &lt;50%
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#71717a' }} />
          no data
        </div>
        <span className="ml-auto">{nodes.length} nodes / {drawableEdges.length} edges</span>
      </div>
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-auto">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minHeight: 480, maxHeight: 700, display: 'block' }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#52525b" />
            </marker>
            <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308" />
            </marker>
          </defs>
          <g>
            {drawableEdges.map((e, i) => {
              const a = nodeIndex.get(e.from);
              const b = nodeIndex.get(e.to);
              if (!a || !b) return null;
              const isHi = highlight && (e.from === highlight || e.to === highlight);
              // Trim line endpoints to node radii so arrow sits on the boundary.
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const x1 = a.x + ux * a.r;
              const y1 = a.y + uy * a.r;
              const x2 = b.x - ux * b.r;
              const y2 = b.y - uy * b.r;
              return (
                <line
                  key={`${e.from}->${e.to}-${i}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isHi ? '#eab308' : '#3f3f46'}
                  strokeWidth={isHi ? 1.6 : 1}
                  opacity={highlight && !isHi ? 0.25 : 1}
                  markerEnd={isHi ? 'url(#arrow-hi)' : 'url(#arrow)'}
                />
              );
            })}
          </g>
          <g>
            {nodes.map((n) => {
              const isHi = highlight === n.id;
              const inNeighborhood = !highlight || highlightNeighbors.has(n.id);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  style={{ cursor: 'pointer', opacity: inNeighborhood ? 1 : 0.25 }}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onClick={() => setSelected(n.id)}
                >
                  <circle
                    r={n.r}
                    fill={n.color}
                    stroke={isHi || selected === n.id ? '#fafafa' : '#18181b'}
                    strokeWidth={isHi || selected === n.id ? 2 : 1.2}
                    fillOpacity={0.85}
                  />
                  <text
                    y={n.r + 12}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#d4d4d8"
                    style={{ pointerEvents: 'none', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                  >
                    {n.short.length > 22 ? n.short.slice(0, 21) + '...' : n.short}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {selectedNode && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Skill details: ${selectedNode.label}`}
            onKeyDown={handleDrawerKeyDown}
            tabIndex={-1}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-zinc-950 border-l border-zinc-800 z-50 overflow-y-auto"
          >
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-white truncate">
                    {selectedNode.label}
                  </h2>
                  <p className="text-[10px] text-zinc-500 font-mono truncate">{selectedNode.short}</p>
                </div>
                <button
                  ref={closeButtonRef}
                  onClick={() => setSelected(null)}
                  className="text-zinc-500 hover:text-white text-sm leading-none px-1"
                  aria-label="Close"
                >
                  X
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg py-2">
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">Success</div>
                  <div className="text-sm font-mono text-green-400">{selectedNode.data.successCount ?? 0}</div>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg py-2">
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">Failure</div>
                  <div className="text-sm font-mono text-red-400">{selectedNode.data.failureCount ?? 0}</div>
                </div>
                <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg py-2">
                  <div className="text-[9px] uppercase tracking-wide text-zinc-500">Quality</div>
                  <div className="text-sm font-mono text-zinc-300">
                    {typeof selectedNode.data.quality === 'number' ? selectedNode.data.quality.toFixed(2) : '-'}
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-zinc-500">
                Status: <span style={{ color: selectedNode.color }}>{colorLabel(selectedNode.successRate, selectedNode.total)}</span>
                {selectedNode.successRate !== null && (
                  <> &middot; success rate {(selectedNode.successRate * 100).toFixed(0)}%</>
                )}
              </div>

              {selectedNode.data.description && (
                <p className="text-xs text-zinc-400">{selectedNode.data.description}</p>
              )}

              {(selectedOutgoing.length > 0 || selectedIncoming.length > 0) && (
                <div className="space-y-2">
                  {selectedOutgoing.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Calls</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedOutgoing.map((e) => (
                          <button
                            key={`out-${e.to}`}
                            onClick={() => setSelected(e.to)}
                            className="text-[10px] font-mono bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300"
                          >
                            {e.to}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedIncoming.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Called by</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedIncoming.map((e) => (
                          <button
                            key={`in-${e.from}`}
                            onClick={() => setSelected(e.from)}
                            className="text-[10px] font-mono bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300"
                          >
                            {e.from}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {stats?.topPerformers?.some((p) => p.name === selectedNode.short) && (
                <div className="text-[10px] text-amber-400">Top performer (fleet-wide)</div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500">Code</div>
                  {fullCode && <CopyButton text={fullCode} />}
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 max-h-[40vh] overflow-auto">
                  {fullCode ? (
                    <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed">{fullCode}</pre>
                  ) : (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-3 h-3 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
                      <span className="text-[11px] text-zinc-500">Loading code...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
