/**
 * Control-platform CRUD endpoints (markers, zones, routes, squads, roles),
 * extracted from createAPIServer (review: api.ts decomposition). Compact
 * single-manager-per-group handlers. Registered via registerControlRoutes(app,
 * { markerStore, squadManager, roleManager }).
 */
import type { Express } from 'express';
import type { MarkerStore } from '../../control/MarkerStore';
import type { SquadManager } from '../../control/SquadManager';
import type { RoleManager } from '../../control/RoleManager';

export function registerControlRoutes(
  app: Express,
  deps: { markerStore: MarkerStore; squadManager: SquadManager; roleManager: RoleManager },
): void {
  const { markerStore, squadManager, roleManager } = deps;

  // ── Markers ──
  app.get('/api/markers', (_req, res) => res.json({ markers: markerStore.getMarkers() }));
  app.post('/api/markers', (req, res) => {
    try { res.status(201).json({ marker: markerStore.createMarker(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/markers/:id', (req, res) => {
    const m = markerStore.updateMarker(req.params.id as string, req.body);
    if (!m) return res.status(404).json({ error: 'Marker not found' });
    res.json({ marker: m });
  });
  app.delete('/api/markers/:id', (req, res) => {
    const ok = markerStore.deleteMarker(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ── Zones ──
  app.get('/api/zones', (_req, res) => res.json({ zones: markerStore.getZones() }));
  app.post('/api/zones', (req, res) => {
    try { res.status(201).json({ zone: markerStore.createZone(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/zones/:id', (req, res) => {
    const z = markerStore.updateZone(req.params.id as string, req.body);
    if (!z) return res.status(404).json({ error: 'Zone not found' });
    res.json({ zone: z });
  });
  app.delete('/api/zones/:id', (req, res) => {
    const ok = markerStore.deleteZone(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ── Routes (paths) ──
  app.get('/api/routes', (_req, res) => res.json({ routes: markerStore.getRoutes() }));
  app.post('/api/routes', (req, res) => {
    try { res.status(201).json({ route: markerStore.createRoute(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/routes/:id', (req, res) => {
    const r = markerStore.updateRoute(req.params.id as string, req.body);
    if (!r) return res.status(404).json({ error: 'Route not found' });
    res.json({ route: r });
  });
  app.delete('/api/routes/:id', (req, res) => {
    const ok = markerStore.deleteRoute(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  // ── Squads ──
  app.get('/api/squads', (_req, res) => res.json({ squads: squadManager.getSquads() }));
  app.post('/api/squads', (req, res) => {
    try { res.status(201).json({ squad: squadManager.createSquad(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/squads/:id', (req, res) => {
    const s = squadManager.getSquad(req.params.id as string);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });
  app.patch('/api/squads/:id', (req, res) => {
    const s = squadManager.updateSquad(req.params.id as string, req.body);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });
  app.delete('/api/squads/:id', (req, res) => {
    const ok = squadManager.deleteSquad(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.post('/api/squads/:id/bots', (req, res) => {
    const { botName } = req.body;
    if (!botName) return res.status(400).json({ error: 'botName required' });
    const s = squadManager.addBotToSquad(req.params.id as string, botName);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });
  app.delete('/api/squads/:id/bots/:botName', (req, res) => {
    const s = squadManager.removeBotFromSquad(req.params.id as string, req.params.botName as string);
    if (!s) return res.status(404).json({ error: 'Squad not found' });
    res.json({ squad: s });
  });

  // ── Roles ──
  app.get('/api/roles/assignments', (_req, res) => res.json({ assignments: roleManager.getAssignments() }));
  app.post('/api/roles/assignments', (req, res) => {
    try { res.status(201).json({ assignment: roleManager.createAssignment(req.body) }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.patch('/api/roles/assignments/:id', (req, res) => {
    const a = roleManager.updateAssignment(req.params.id as string, req.body);
    if (!a) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ assignment: a });
  });
  app.delete('/api/roles/assignments/:id', (req, res) => {
    const ok = roleManager.deleteAssignment(req.params.id as string);
    res.status(ok ? 200 : 404).json({ success: ok });
  });
  app.get('/api/roles/approvals', (_req, res) => res.json({ approvals: roleManager.getApprovalRequests() }));
  app.post('/api/roles/approvals/:id/approve', (req, res) => {
    const { decidedBy, decisionNote } = req.body ?? {};
    const r = roleManager.approveApprovalRequest(req.params.id as string, decidedBy, decisionNote);
    if (!r) return res.status(404).json({ error: 'Approval request not found' });
    res.json({ request: r });
  });
  app.post('/api/roles/approvals/:id/reject', (req, res) => {
    const { decidedBy, decisionNote } = req.body ?? {};
    const r = roleManager.rejectApprovalRequest(req.params.id as string, decidedBy, decisionNote);
    if (!r) return res.status(404).json({ error: 'Approval request not found' });
    res.json({ request: r });
  });
  app.get('/api/roles/overrides', (_req, res) => res.json({ overrides: roleManager.getOverrides() }));
  app.delete('/api/bots/:name/override', (req, res) => {
    roleManager.clearOverride(req.params.name as string);
    res.json({ success: true });
  });
}
