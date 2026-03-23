# Wireframes

## Dashboard

```text
+--------------------------------------------------------------------------------+
| Fleet Overview                                                                 |
| Bots Online | Active Missions | Pending Commands | Alerts | Selected Bots      |
+--------------------------------------------------------------------------------+
| Filters: [State] [Role] [Squad] [Health] [Attention Needed]                    |
+-----------------------------------+--------------------------------------------+
| Fleet Grid                         | Ops Feed                                   |
| [Ada][state][role][mission]        | - command failed: Ada unstuck             |
| [Bex][state][role][mission]        | - mission blocked: Builders resupply      |
| [Cy ][state][role][mission]        | - squad Guards arrived at village         |
+-----------------------------------+--------------------------------------------+
| Bulk Actions: [Pause] [Regroup] [Move To Marker] [Assign Role] [Create Squad] |
+--------------------------------------------------------------------------------+
```

## Bot Detail

```text
+--------------------------------------------------------------------------------+
| Ada / Guard Bot                                                    [State pill] |
| Mode | Position | Role | Override State | Current Mission                        |
+-----------------------------------+--------------------------------------------+
| Quick Commands                     | Mission Queue                              |
| [Pause] [Stop] [Follow] [Go To]    | 1. Guard north gate                        |
| [Return Home] [Deposit] [Unstuck]  | 2. Regroup at Base                         |
|                                   | 3. Escort Player Sam                       |
+-----------------------------------+--------------------------------------------+
| Diagnostics                        | Inventory / Equipment                      |
| Last success                       | armor, tools, hotbar                       |
| Last failure                       |                                            |
| Blockers                           |                                            |
+-----------------------------------+--------------------------------------------+
| Command History / Event Timeline                                                |
+--------------------------------------------------------------------------------+
```

## Map

```text
+--------------------------------------------------------------------------------+
| Map Toolbar: [Select] [Move] [Marker] [Zone] [Route] [Mission] [Squad]        |
+------------------------------+-------------------------------------------------+
| Layers                       |                                                 |
| [x] Bots                     |                 World Map Canvas                |
| [x] Players                  |                                                 |
| [x] Markers                  |     click terrain -> move / mission menu       |
| [x] Zones                    |     click bot -> select / command              |
| [x] Missions                 |     drag -> zone / route                       |
+------------------------------+-------------------------------------------------+
| Selected Object Panel                                                          |
| Marker: Storage A | Actions: Move here | Guard here | Set home | Build here   |
+--------------------------------------------------------------------------------+
```

## Fleet

```text
+--------------------------------------------------------------------------------+
| Fleet Control                                                                   |
| Search | Filters | Selection Count | Save as Squad                             |
+--------------------------------------------------------------------------------+
| Bot Table                                                                       |
| [ ] Ada | Guard | Running | Mission: Patrol gate | Health 18 | Role Guard     |
| [ ] Bex | Builder | Paused | Mission: Build tower | Health 20 | Role Builder  |
| [ ] Cy  | Hauler | Idle | Mission: None | Health 20 | Role Hauler             |
+--------------------------------------------------------------------------------+
| Batch Actions: [Command] [Mission] [Role] [Marker] [Cancel]                    |
+--------------------------------------------------------------------------------+
```

## Roles

```text
+--------------------------------------------------------------------------------+
| Role Assignments                                                                |
+-------------------------------+------------------------------------------------+
| Role Catalog                  | Assignment Editor                              |
| Guard                         | Bot: Ada                                       |
| Builder                       | Role: Guard                                    |
| Hauler                        | Home Marker: North Gate                        |
| Farmer                        | Allowed Zones: Gate Perimeter                  |
| Miner                         | Autonomy: Assisted                             |
+-------------------------------+------------------------------------------------+
```

## Commander

```text
+--------------------------------------------------------------------------------+
| Commander Console                                                               |
| > send all guards to the village and hold position                              |
|                                                                                |
| Parsed Plan                                                                     |
| - command: move squad Guards to marker Village                                 |
| - mission: hold perimeter at Village                                            |
| Warnings: none                                                                  |
| Confidence: 0.92                                                                |
| [Confirm Execute] [Edit] [Cancel]                                               |
+--------------------------------------------------------------------------------+
```
