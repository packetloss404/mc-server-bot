const state = {
  selectedBot: null,
  bots: [],
  detailed: null,
  tasks: null,
  inventory: [],
  relationships: [],
  conversations: [],
  world: null,
  activity: [],
  blackboard: null,
};

const els = {
  botList: document.getElementById('bot-list'),
  worldPill: document.getElementById('world-pill'),
  worldTime: document.getElementById('world-time'),
  worldSummary: document.getElementById('world-summary'),
  activityFeed: document.getElementById('activity-feed'),
  heroName: document.getElementById('hero-name'),
  heroSubtitle: document.getElementById('hero-subtitle'),
  statusCard: document.getElementById('status-card'),
  directiveCard: document.getElementById('directive-card'),
  executionCard: document.getElementById('execution-card'),
  tasksPanel: document.getElementById('tasks-panel'),
  inventoryPanel: document.getElementById('inventory-panel'),
  relationshipsPanel: document.getElementById('relationships-panel'),
  conversationsPanel: document.getElementById('conversations-panel'),
  blackboardPanel: document.getElementById('blackboard-panel'),
  blackboardMessages: document.getElementById('blackboard-messages'),
  taskForm: document.getElementById('task-form'),
  taskInput: document.getElementById('task-input'),
  swarmForm: document.getElementById('swarm-form'),
  swarmInput: document.getElementById('swarm-input'),
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
}

async function refreshBots() {
  const data = await getJSON('/api/bots');
  state.bots = data.bots || [];
  if (!state.selectedBot && state.bots[0]) state.selectedBot = state.bots[0].name;
  renderBotList();
}

async function refreshWorld() {
  state.world = await getJSON('/api/world');
  renderWorld();
}

async function refreshActivity() {
  const data = await getJSON('/api/activity?limit=18');
  state.activity = data.events || [];
  renderActivity();
}

async function refreshBlackboard() {
  const data = await getJSON('/api/blackboard');
  state.blackboard = data.blackboard || null;
  renderBlackboard();
}

async function refreshSelectedBot() {
  if (!state.selectedBot) return;
  const [detailed, tasks, inventory, relationships, conversations] = await Promise.all([
    getJSON(`/api/bots/${encodeURIComponent(state.selectedBot)}/detailed`),
    getJSON(`/api/bots/${encodeURIComponent(state.selectedBot)}/tasks`),
    getJSON(`/api/bots/${encodeURIComponent(state.selectedBot)}/inventory`),
    getJSON(`/api/bots/${encodeURIComponent(state.selectedBot)}/relationships`),
    getJSON(`/api/bots/${encodeURIComponent(state.selectedBot)}/conversations`),
  ]);
  state.detailed = detailed.bot;
  state.tasks = tasks;
  state.inventory = inventory.inventory || [];
  state.relationships = relationships.relationships || [];
  state.conversations = conversations.conversations || [];
  renderSelectedBot();
}

function renderBotList() {
  els.botList.innerHTML = '';
  if (!state.bots.length) {
    els.botList.innerHTML = '<div class="list-item">No bots connected.</div>';
    return;
  }
  state.bots.forEach((bot) => {
    const button = document.createElement('button');
    button.className = `bot-button${bot.name === state.selectedBot ? ' active' : ''}`;
    button.innerHTML = `<strong>${bot.name}</strong><div class="muted">${bot.personality} · ${bot.mode} · ${bot.state}</div>`;
    button.onclick = async () => {
      state.selectedBot = bot.name;
      renderBotList();
      await refreshSelectedBot();
    };
    els.botList.appendChild(button);
  });
}

function renderWorld() {
  const world = state.world || {};
  els.worldPill.textContent = world.onlineBots ? `${world.onlineBots} bot${world.onlineBots === 1 ? '' : 's'} online` : 'No bots online';
  els.worldTime.textContent = world.timeOfDay || '--';
  els.worldSummary.innerHTML = [
    ['Day', world.day ?? '--'],
    ['Weather', world.isRaining ? 'Rain' : 'Clear'],
    ['Ticks', world.timeOfDayTicks ?? '--'],
  ].map(([k, v]) => `<div class="kv"><span>${k}</span><span class="value-strong">${v}</span></div>`).join('');
}

function renderActivity() {
  els.activityFeed.innerHTML = state.activity.length
    ? state.activity.map((event) => `<div class="activity-item"><strong>${event.botName || event.type}</strong><p class="muted">${event.description}</p></div>`).join('')
    : '<div class="list-item">No recent activity.</div>';
}

function renderSelectedBot() {
  const bot = state.detailed;
  if (!bot) {
    els.heroName.textContent = 'Select a bot';
    return;
  }

  els.heroName.textContent = bot.name;
  els.heroSubtitle.textContent = `${bot.personalityDisplayName} · ${bot.mode} mode · ${bot.state}`;

  const voyager = bot.voyager || {};
  els.statusCard.innerHTML = [
    ['Mode', bot.mode],
    ['State', bot.state],
    ['Position', bot.position ? `${bot.position.x}, ${bot.position.y}, ${bot.position.z}` : '--'],
    ['Health', bot.health ?? '--'],
    ['Food', bot.food ?? '--'],
    ['Biome', bot.world?.biome || '--'],
  ].map(row).join('');

  const goal = voyager.longTermGoal;
  els.directiveCard.innerHTML = goal
    ? `${row(['Goal', goal.rawRequest])}${row(['Kind', goal.kind])}${row(['Status', goal.status])}${row(['Build State', goal.buildState || '--'])}<div class="chips">${(goal.pendingSubtasks || []).slice(0, 8).map(tag).join('')}</div>`
    : '<div class="list-item">No active long-term directive.</div>';

  els.executionCard.innerHTML = `${row(['Current', voyager.currentTask || '--'])}${row(['Queued', (voyager.queuedTasks || []).length])}${row(['Completed', (voyager.completedTasks || []).length])}${row(['Failed', (voyager.failedTasks || []).length])}${row(['Running', voyager.isRunning ? 'Yes' : 'No'])}${row(['Paused', voyager.isPaused ? 'Yes' : 'No'])}`;

  const tasks = state.tasks || {};
  els.tasksPanel.innerHTML = [
    sectionList('Current', tasks.currentTask ? [tasks.currentTask] : []),
    sectionList('Queued', tasks.queuedTasks || []),
    sectionList('Completed', (tasks.completedTasks || []).slice(-8).reverse()),
    sectionList('Failed', (tasks.failedTasks || []).slice(-8).reverse()),
  ].join('');

  els.inventoryPanel.innerHTML = state.inventory.length
    ? state.inventory.map((item) => `<div class="inventory-item"><strong>${item.name}</strong><span>x${item.count}</span></div>`).join('')
    : '<div class="list-item">Inventory empty.</div>';

  els.relationshipsPanel.innerHTML = state.relationships.length
    ? state.relationships.map((rel) => `<div class="list-item"><strong>${rel.playerName || rel.player || 'Player'}</strong><p class="muted">Affinity ${rel.score ?? rel.affinity ?? '--'}</p></div>`).join('')
    : '<div class="list-item">No relationship data.</div>';

  els.conversationsPanel.innerHTML = state.conversations.length
    ? state.conversations.slice(0, 10).map((conv) => `<div class="conversation"><strong>${conv.playerName || conv.player || 'Conversation'}</strong><p class="muted">${summarizeConversation(conv.messages || conv.history || [])}</p></div>`).join('')
    : '<div class="list-item">No recent conversation history.</div>';
}

function renderBlackboard() {
  const board = state.blackboard;
  if (!board) {
    els.blackboardPanel.innerHTML = '<div class="list-item">No blackboard state.</div>';
    els.blackboardMessages.innerHTML = '<div class="list-item">No coordination messages.</div>';
    return;
  }

  const swarmGoal = board.swarmGoal
    ? `${row(['Swarm Goal', board.swarmGoal.rawRequest])}${row(['Status', board.swarmGoal.status])}`
    : '<div class="list-item">No active swarm goal.</div>';

  const claimed = (board.tasks || []).filter((task) => task.status === 'claimed');
  const blocked = (board.tasks || []).filter((task) => task.status === 'blocked');
  const reservations = board.reservations || [];

  els.blackboardPanel.innerHTML = `
    ${swarmGoal}
    <div class="list-item"><strong>Claimed Tasks</strong>${claimed.length ? `<div class="chips">${claimed.map((task) => tag(`${task.assignedBot || 'unassigned'} -> ${task.description}`)).join('')}</div>` : '<p class="muted">None</p>'}</div>
    <div class="list-item"><strong>Blocked Tasks</strong>${blocked.length ? `<div class="chips">${blocked.map((task) => tag(`${task.description}: ${task.blocker || 'blocked'}`)).join('')}</div>` : '<p class="muted">None</p>'}</div>
    <div class="list-item"><strong>Reservations</strong>${reservations.length ? `<div class="chips">${reservations.slice(0, 20).map((res) => tag(`${res.botName}: ${res.type} ${res.key}`)).join('')}</div>` : '<p class="muted">None</p>'}</div>
  `;

  els.blackboardMessages.innerHTML = (board.messages || []).length
    ? board.messages.slice(-16).reverse().map((msg) => `<div class="list-item"><strong>${msg.botName}</strong><p class="muted">${msg.kind}</p><p>${escapeHTML(msg.text)}</p></div>`).join('')
    : '<div class="list-item">No coordination messages.</div>';
}

function row([label, value]) {
  return `<div class="kv"><span>${label}</span><span class="value-strong">${escapeHTML(String(value))}</span></div>`;
}

function sectionList(title, items) {
  return `<div class="list-item"><strong>${title}</strong>${items.length ? `<div class="chips">${items.map(tag).join('')}</div>` : '<p class="muted">None</p>'}</div>`;
}

function tag(text) {
  return `<span class="tag">${escapeHTML(String(text))}</span>`;
}

function summarizeConversation(messages) {
  return messages.slice(-3).map((msg) => typeof msg === 'string' ? msg : `${msg.role || msg.speaker || 'msg'}: ${msg.content || msg.text || ''}`).join(' | ');
}

function escapeHTML(text) {
  return text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

async function boot() {
  await Promise.all([refreshBots(), refreshWorld(), refreshActivity(), refreshBlackboard()]);
  await refreshSelectedBot();

  const socket = io();
  ['bot:spawn', 'bot:disconnect', 'bot:position', 'bot:health', 'bot:state', 'bot:inventory', 'activity', 'world:time'].forEach((eventName) => {
    socket.on(eventName, async () => {
      await Promise.all([refreshBots(), refreshWorld(), refreshActivity(), refreshBlackboard()]);
      await refreshSelectedBot();
    });
  });

  els.taskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedBot || !els.taskInput.value.trim()) return;
    await fetch(`/api/bots/${encodeURIComponent(state.selectedBot)}/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: els.taskInput.value.trim() }),
    });
    els.taskInput.value = '';
    await refreshSelectedBot();
    await refreshActivity();
    await refreshBlackboard();
  });

  els.swarmForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const description = els.swarmInput.value.trim();
    if (!description || !state.selectedBot) return;
    await fetch(`/api/swarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, requestedBy: 'dashboard' }),
    });
    els.swarmInput.value = '';
    await Promise.all([refreshBots(), refreshSelectedBot(), refreshActivity(), refreshBlackboard()]);
  });
}

boot().catch((err) => {
  console.error(err);
  els.heroSubtitle.textContent = `Dashboard failed to load: ${err.message}`;
});
