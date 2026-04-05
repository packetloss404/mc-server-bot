import { Page } from '@playwright/test';
import * as mock from './mock-data';

const API = 'http://localhost:3001';

/**
 * Intercept all backend API calls with deterministic mock responses.
 * Also stubs the Socket.IO connection so the frontend initialises its store
 * from the mocked REST data instead of waiting on a WebSocket handshake.
 */
export async function interceptAll(page: Page) {
  // --- Socket.IO: prevent real connection attempts ---
  await page.route(`${API}/socket.io/**`, (route) =>
    route.fulfill({ status: 200, body: '' }),
  );

  // --- Bot endpoints ---
  await page.route(`${API}/api/bots`, (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({ json: mock.BOTS });
    }
    // POST – create bot
    return route.fulfill({
      json: { success: true, bot: { name: 'NewBot', personality: 'merchant', mode: 'codegen', state: 'SPAWNING', position: null } },
    });
  });

  await page.route(`${API}/api/bots/*/detailed`, (route) =>
    route.fulfill({ json: mock.BOT_DETAILED }),
  );

  await page.route(`${API}/api/bots/*/relationships`, (route) =>
    route.fulfill({ json: mock.BOT_RELATIONSHIPS }),
  );

  await page.route(`${API}/api/bots/*/conversations`, (route) =>
    route.fulfill({ json: mock.BOT_CONVERSATIONS }),
  );

  await page.route(`${API}/api/bots/*/tasks`, (route) =>
    route.fulfill({
      json: {
        currentTask: mock.BOT_DETAILED.bot.voyager.currentTask,
        completedTasks: mock.BOT_DETAILED.bot.voyager.completedTasks,
        failedTasks: mock.BOT_DETAILED.bot.voyager.failedTasks,
      },
    }),
  );

  // Bot actions: pause, resume, stop, follow, walkto, chat, task, mode
  await page.route(`${API}/api/bots/*/pause`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/resume`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/stop`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/follow`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/walkto`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/chat`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/task`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*/mode`, (route) =>
    route.fulfill({ json: { success: true } }),
  );
  await page.route(`${API}/api/bots/*`, (route, request) => {
    if (request.method() === 'DELETE') {
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: mock.BOTS });
  });

  // --- Players ---
  await page.route(`${API}/api/players`, (route) =>
    route.fulfill({ json: mock.PLAYERS }),
  );

  // --- World ---
  await page.route(`${API}/api/world`, (route) =>
    route.fulfill({ json: mock.WORLD }),
  );

  // --- Activity ---
  await page.route(`${API}/api/activity*`, (route) =>
    route.fulfill({ json: mock.ACTIVITY }),
  );

  // --- Skills ---
  await page.route(`${API}/api/skills`, (route) =>
    route.fulfill({ json: mock.SKILLS }),
  );

  // --- Terrain ---
  await page.route(`${API}/api/terrain*`, (route) =>
    route.fulfill({ json: mock.TERRAIN }),
  );

  // --- Control platform ---
  await page.route(`${API}/api/commands`, (route, request) => {
    if (request.method() === 'POST') {
      return route.fulfill({ json: { success: true, command: mock.COMMANDS_LIST.commands[0] } });
    }
    return route.fulfill({ json: mock.COMMANDS_LIST });
  });

  await page.route(`${API}/api/missions`, (route, request) => {
    if (request.method() === 'POST') {
      return route.fulfill({ json: { success: true, mission: mock.MISSIONS_LIST.missions[0] } });
    }
    return route.fulfill({ json: mock.MISSIONS_LIST });
  });

  await page.route(`${API}/api/markers`, (route) =>
    route.fulfill({ json: mock.MARKERS }),
  );

  await page.route(`${API}/api/zones`, (route) =>
    route.fulfill({ json: mock.ZONES }),
  );

  await page.route(`${API}/api/routes`, (route) =>
    route.fulfill({ json: mock.ROUTES }),
  );

  await page.route(`${API}/api/commander/parse`, (route) =>
    route.fulfill({ json: mock.COMMANDER_PARSE }),
  );

  await page.route(`${API}/api/commander/execute`, (route) =>
    route.fulfill({ json: mock.COMMANDER_EXECUTE }),
  );

  // --- Relationships (global) ---
  await page.route(`${API}/api/relationships`, (route) =>
    route.fulfill({
      json: {
        relationships: {
          Farmer_Joe: mock.BOT_RELATIONSHIPS.relationships,
        },
      },
    }),
  );
}

/**
 * Seed the Zustand store via page.evaluate so the frontend has
 * initial data without needing a real Socket.IO connection.
 */
export async function seedStore(page: Page) {
  await page.evaluate((data) => {
    // The store is exposed on the window via the SocketProvider / zustand devtools
    // but since it's a module-scoped singleton, we access it through the __ZUSTAND__
    // bridge we inject. If the app hasn't exposed it, fall back to a no-op.
    const win = window as any;

    // Wait for React hydration, then poke the store
    // The SocketProvider calls setBots on socket 'init', we simulate that.
    if (win.__NEXT_DATA__ || document.querySelector('[data-reactroot]') || document.querySelector('#__next')) {
      // Dispatch a custom event the SocketProvider can pick up, or directly
      // manipulate the store via the React fiber tree.  For robustness,
      // we use a fetch-based approach: the mocked /api/bots already returns
      // the data, so the app's own useEffect will pick it up.
    }
  }, { bots: mock.BOTS.bots, players: mock.PLAYERS.players, world: mock.WORLD });
}
