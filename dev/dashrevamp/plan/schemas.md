# Domain Schemas

## Command

```ts
interface CommandRecord {
  id: string;
  type: CommandType;
  scope: 'bot' | 'squad' | 'selection';
  targets: string[];
  payload: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  source: 'dashboard' | 'map' | 'role' | 'routine' | 'commander' | 'api';
  requestedBy?: string;
  status: 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean };
}
```

### Command types for this repo

- `pause_voyager`
- `resume_voyager`
- `stop_movement`
- `follow_player`
- `walk_to_coords`
- `move_to_marker`
- `return_to_base`
- `regroup`
- `guard_zone`
- `patrol_route`
- `deposit_inventory`
- `equip_best`
- `unstuck`

## Mission

```ts
interface MissionRecord {
  id: string;
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  status: 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  blockedReason?: string;
  linkedCommandIds?: string[];
  source: 'dashboard' | 'map' | 'role' | 'routine' | 'commander';
}
```

```ts
interface MissionStep {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  error?: string;
}
```

### Mission types for this repo

- `queue_task`
- `gather_items`
- `craft_items`
- `smelt_batch`
- `build_schematic`
- `supply_chain`
- `patrol_zone`
- `escort_player`
- `resupply_builder`

## Marker

```ts
interface MarkerRecord {
  id: string;
  name: string;
  kind: 'base' | 'storage' | 'build-site' | 'mine' | 'village' | 'custom';
  position: { x: number; y: number; z: number };
  tags: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}
```

## Zone

```ts
interface ZoneRecord {
  id: string;
  name: string;
  mode: 'guard' | 'avoid' | 'farm' | 'build' | 'gather' | 'custom';
  shape: 'circle' | 'rectangle';
  circle?: { x: number; z: number; radius: number };
  rectangle?: { minX: number; minZ: number; maxX: number; maxZ: number };
  markerIds?: string[];
  rules?: Record<string, unknown>;
}
```

## Route

```ts
interface RouteRecord {
  id: string;
  name: string;
  waypointIds: string[];
  loop: boolean;
}
```

## Squad

```ts
interface SquadRecord {
  id: string;
  name: string;
  botNames: string[];
  defaultRole?: string;
  homeMarkerId?: string;
  activeMissionId?: string;
  createdAt: number;
  updatedAt: number;
}
```

## Role Assignment

```ts
interface RoleAssignmentRecord {
  id: string;
  botName: string;
  role: 'guard' | 'builder' | 'hauler' | 'farmer' | 'miner' | 'scout' | 'merchant' | 'free-agent';
  autonomyLevel: 'manual' | 'assisted' | 'autonomous';
  homeMarkerId?: string;
  allowedZoneIds: string[];
  preferredMissionTypes: string[];
  loadoutPolicy?: Record<string, unknown>;
  interruptPolicy?: 'always' | 'confirm-if-busy' | 'never-while-critical';
}
```

## Commander Plan

```ts
interface CommanderPlan {
  id: string;
  input: string;
  parsedIntent: string;
  confidence: number;
  requiresConfirmation: boolean;
  warnings: string[];
  commands: CommandRecord[];
  missions: MissionRecord[];
}
```

## Persistence Notes For This Repo

- use JSON-friendly, append-safe records
- store IDs as strings to avoid coupling to runtime memory references
- keep backward compatibility with current build and supply-chain data where possible
