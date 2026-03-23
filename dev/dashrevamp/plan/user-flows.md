# User Flows

## Flow 1 - Tactical Single-Bot Command

1. Operator opens bot detail page
2. Operator clicks `Return To Base`
3. Frontend creates a command via `POST /api/commands`
4. Backend validates the target bot and marker
5. Backend emits `command:queued` and `command:started`
6. UI shows pending state on the command center and in history
7. Backend emits success or failure event
8. UI stores result and offers retry if needed

## Flow 2 - Queue A Mission

1. Operator enters a mission on bot detail page
2. Operator chooses `Do now` or `Do next`
3. Frontend creates a mission or queue entry
4. Backend links mission to `VoyagerLoop`
5. Mission state becomes visible on the queue panel
6. On decomposition, subtasks update the mission view
7. If blocked, UI shows reason and recovery actions

## Flow 3 - Map-First Move Command

1. Operator selects one or more bots on the map
2. Operator clicks a location
3. Map context menu offers `Move`, `Guard here`, `Create marker`, `Build here`
4. Operator chooses `Move`
5. Frontend submits a command with map coordinates or marker reference
6. Live events update command and bot movement state

## Flow 4 - Create And Use A Marker

1. Operator enters marker mode on the map
2. Operator places a marker and names it `Storage A`
3. Marker is persisted and broadcast
4. Marker appears in command dropdowns, role settings, and mission creation flows

## Flow 5 - Create Squad And Run Batch Command

1. Operator selects four bots in fleet view
2. Operator saves them as squad `Builders`
3. Operator chooses `Move to Build Site 2`
4. Backend creates one squad-scoped command and child bot results
5. UI shows aggregated progress and partial failures

## Flow 6 - Assign Role

1. Operator opens roles page
2. Operator assigns bot `Cy` to role `Hauler`
3. Operator picks home marker and allowed zones
4. Backend stores assignment and enables role policy evaluation
5. UI shows current role, autonomy level, and active policy-generated missions

## Flow 7 - Natural Language Command

1. Operator types: `send all guards to the village`
2. Frontend calls `POST /api/commander/parse`
3. Backend returns a typed plan preview
4. Operator confirms execution
5. Commands and missions are created normally through shared services
6. UI tracks them like any other action
