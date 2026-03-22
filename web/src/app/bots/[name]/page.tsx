'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { api, type BotDetailed, type ChatMessage } from '@/lib/api';
import { getPersonalityColor, getAffinityTier, STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS } from '@/lib/constants';
import { formatItemName, getItemCategoryColorByName } from '@/lib/items';
import { EquipmentDisplay } from '@/components/EquipmentDisplay';
import { BotActivityPanel } from '@/components/BotActivityPanel';
import { StatsPanel } from '@/components/StatsPanel';
import { WorldContext } from '@/components/WorldContext';
import { BotCommandCenter } from '@/components/BotCommandCenter';

export default function BotProfilePage() {
  const params = useParams();
  const name = params.name as string;
  const [bot, setBot] = useState<BotDetailed | null>(null);
  const [relationships, setRelationships] = useState<Record<string, number>>({});
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [sendingTask, setSendingTask] = useState(false);
  const [chatMsg, setChatMsg] = useState('');
  const [chatPlayer, setChatPlayer] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  useEffect(() => {
    const load = () => {
      api.getBotDetailed(name).then((data) => { setBot(data.bot); setError(null); }).catch((e) => setError(e.message));
      api.getBotRelationships(name).then((data) => setRelationships(data.relationships)).catch(() => {});
      api.getBotConversations(name).then((data) => setConversations(data.conversations)).catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [name]);

  const handleQueueTask = async () => {
    if (!taskInput.trim()) return;
    setSendingTask(true);
    try { await api.queueTask(name, taskInput.trim()); setTaskInput(''); } catch { /* ignore */ }
    setSendingTask(false);
  };

  const handleSendChat = async () => {
    if (!chatMsg.trim()) return;
    const player = chatPlayer.trim() || 'admin';
    try { await api.sendChat(name, player, chatMsg.trim()); setChatMsg(''); } catch { /* ignore */ }
  };

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        </div>
        <p className="text-red-400 text-sm">{error}</p>
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mt-3 inline-block">Back to Dashboard</Link>
      </div>
    );
  }

  if (!bot) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading {name}...</p>
        </div>
      </div>
    );
  }

  const accentColor = getPersonalityColor(bot.personality);
  const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
  const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';
  const defaultArmor = { helmet: null, chestplate: null, leggings: null, boots: null };
  const defaultStats = { mined: {}, crafted: {}, smelted: {}, placed: {}, killed: {}, withdrew: {}, deposited: {}, deaths: 0, interrupts: 0, movementTimeouts: 0, damageTaken: 0 };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <Link href="/" className="hover:text-zinc-300 transition-colors">Dashboard</Link>
        <span>/</span>
        <span className="text-zinc-400">{bot.name}</span>
      </div>

      {/* ═══ HERO SECTION ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
      >
        <div className="h-1" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}40)` }} />
        <div className="p-6">
          {/* Top row: Name + State */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="text-xl">{emoji}</span>
                <h1 className="text-2xl font-bold text-white">{bot.name}</h1>
              </div>
              <p className="text-sm mt-1" style={{ color: accentColor }}>{bot.personalityDisplayName}</p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <InfoPill label="Mode" value={bot.mode} color={bot.mode === 'codegen' ? '#10B981' : '#F59E0B'} />
                {bot.position && <InfoPill label="Pos" value={`${Math.round(bot.position.x)}, ${Math.round(bot.position.y)}, ${Math.round(bot.position.z)}`} mono />}
              </div>
            </div>
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg uppercase"
              style={{ color: stateColor, backgroundColor: `${stateColor}12` }}
            >
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: stateColor }} />
              {STATE_LABELS[bot.state] ?? bot.state}
            </span>
          </div>

          {/* Main hero: Equipment + Vitals */}
          <div className="flex items-center justify-between gap-8 flex-wrap">
            {/* Equipment Display */}
            <EquipmentDisplay
              botName={bot.name}
              armor={bot.armor ?? defaultArmor}
              mainHand={bot.equipment}
              offhand={bot.offhand ?? null}
              accentColor={accentColor}
            />

            {/* Vitals */}
            <div className="flex-1 min-w-[200px] max-w-xs space-y-3">
              <VitalBar label="Health" value={bot.health} max={20} color="#EF4444" icon="HP" />
              <VitalBar label="Hunger" value={bot.food} max={20} color="#F59E0B" icon="FD" />
              {bot.experience && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-zinc-500">Experience</span>
                    <span className="text-xs font-bold text-emerald-400">Lv. {bot.experience.level}</span>
                  </div>
                  <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: '#5EE65E' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${bot.experience.progress * 100}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                  <p className="text-[9px] text-zinc-600 mt-0.5 text-right">{bot.experience.points} XP</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══ BODY: 2-column layout ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT COLUMN (3/5) */}
        <div className="lg:col-span-3 space-y-5">
          {/* Activity Panel */}
          <BotActivityPanel
            state={bot.state}
            voyager={bot.voyager}
            combat={bot.combat}
            health={bot.health}
            accentColor={accentColor}
          />

          {/* Command Center */}
          <BotCommandCenter
            botName={bot.name}
            state={bot.state}
            voyagerPaused={bot.voyager?.isPaused}
            voyagerRunning={bot.voyager?.isRunning}
            mode={bot.mode}
          />

          {/* Task Queue */}
          <Section title="Task Queue">
            <div className="flex gap-2 mb-3">
              <input
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleQueueTask()}
                placeholder="Queue a task..."
                className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
              />
              <button
                onClick={handleQueueTask}
                disabled={sendingTask || !taskInput.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              >
                Queue
              </button>
            </div>

            {bot.voyager && (
              <>
                {bot.voyager.completedTasks.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowCompleted(!showCompleted)}
                      className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-semibold uppercase hover:text-zinc-300 transition-colors mb-1"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showCompleted ? 'rotate-90' : ''}`}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      Completed ({bot.voyager.completedTasks.length})
                    </button>
                    {showCompleted && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-0.5 ml-4 overflow-hidden">
                        {bot.voyager.completedTasks.slice(-10).reverse().map((task, i) => (
                          <div key={i} className="text-xs text-zinc-400 truncate flex items-center gap-1.5">
                            <span className="text-emerald-500/60">&#10003;</span> {task}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </div>
                )}
                {bot.voyager.failedTasks.length > 0 && (
                  <div className="mt-2">
                    <button
                      onClick={() => setShowFailed(!showFailed)}
                      className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-semibold uppercase hover:text-zinc-300 transition-colors mb-1"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showFailed ? 'rotate-90' : ''}`}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      Failed ({bot.voyager.failedTasks.length})
                    </button>
                    {showFailed && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="space-y-0.5 ml-4 overflow-hidden">
                        {bot.voyager.failedTasks.slice(-8).reverse().map((task, i) => (
                          <div key={i} className="text-xs text-red-400/60 truncate flex items-center gap-1.5">
                            <span className="text-red-500/60">&#10007;</span> {task}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>

          {/* Inventory */}
          <Section title={`Inventory (${bot.inventory.length})`}>
            {/* Hotbar */}
            {bot.hotbar && bot.hotbar.some((s) => s !== null) && (
              <div className="mb-3">
                <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Hotbar</p>
                <div className="grid grid-cols-9 gap-0.5">
                  {(bot.hotbar || Array(9).fill(null)).map((item, i) => (
                    <InventorySlot key={`hb-${i}`} item={item} highlight />
                  ))}
                </div>
              </div>
            )}
            {/* Main inventory */}
            <div className="grid grid-cols-9 gap-0.5">
              {Array.from({ length: 27 }).map((_, i) => {
                const item = bot.inventory.find((inv) => inv.slot === i + 9);
                return <InventorySlot key={`inv-${i}`} item={item ?? null} />;
              })}
            </div>
          </Section>
        </div>

        {/* RIGHT COLUMN (2/5) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Stats */}
          <StatsPanel stats={bot.stats ?? defaultStats} />

          {/* World Context */}
          {bot.world && (
            <WorldContext
              nearbyEntities={bot.world.nearbyEntities}
              nearbyBlocks={bot.world.nearbyBlocks}
              biome={bot.world.biome}
              timeOfDay={bot.world.timeOfDay}
              isRaining={bot.world.isRaining}
            />
          )}

          {/* Relationships */}
          <Section title={`Relationships (${Object.keys(relationships).length})`}>
            {Object.keys(relationships).length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-3">No relationships yet</p>
            ) : (
              <div className="space-y-2.5">
                {Object.entries(relationships)
                  .sort(([, a], [, b]) => b - a)
                  .map(([player, score]) => {
                    const tier = getAffinityTier(score);
                    return (
                      <button
                        key={player}
                        onClick={() => { setSelectedPlayer(selectedPlayer === player ? null : player); setChatPlayer(player); }}
                        className={`w-full text-left rounded-lg p-2 transition-colors ${selectedPlayer === player ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
                      >
                        <div className="flex items-center gap-2">
                          <img src={`https://mc-heads.net/avatar/${player}/20`} alt="" className="w-5 h-5 rounded pixelated shrink-0" style={{ imageRendering: 'pixelated' }} />
                          <span className="text-xs text-zinc-300 flex-1 truncate">{player}</span>
                          <span style={{ color: tier.color }} className="text-[10px] font-medium">{tier.label} ({score})</span>
                        </div>
                        <div className="h-1.5 w-full bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                          <motion.div className="h-full rounded-full" style={{ backgroundColor: tier.color }} initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.5 }} />
                        </div>
                      </button>
                    );
                  })}
              </div>
            )}
          </Section>

          {/* Conversations */}
          <Section title="Conversations">
            {selectedPlayer && conversations[selectedPlayer] ? (
              <div className="space-y-2">
                <button onClick={() => setSelectedPlayer(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 12H5M12 19l-7-7 7-7" /></svg> Back
                </button>
                <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/40">
                  <img src={`https://mc-heads.net/avatar/${selectedPlayer}/20`} alt="" className="w-5 h-5 rounded pixelated" style={{ imageRendering: 'pixelated' }} />
                  <span className="text-xs text-zinc-300 font-medium">{selectedPlayer}</span>
                </div>
                <div className="max-h-72 overflow-y-auto space-y-2">
                  {conversations[selectedPlayer].map((msg, i) => (
                    <div key={i} className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] ${msg.role === 'model' ? 'ml-auto rounded-br-sm' : 'mr-auto rounded-bl-sm'}`}
                      style={{ backgroundColor: msg.role === 'model' ? `${accentColor}15` : '#1c1c1e', color: msg.role === 'model' ? accentColor : '#a1a1aa' }}>
                      {msg.text}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 pt-2 border-t border-zinc-800/40">
                  <input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                    placeholder={`Reply as ${chatPlayer || 'admin'}...`} className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600" />
                  <button onClick={handleSendChat} disabled={!chatMsg.trim()} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white px-2.5 py-1.5 rounded-lg text-xs transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {Object.keys(conversations).length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-3">No conversations yet</p>
                ) : (
                  Object.entries(conversations).map(([player, msgs]) => (
                    <button key={player} onClick={() => { setSelectedPlayer(player); setChatPlayer(player); }}
                      className="w-full text-left flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-zinc-800/40 transition-colors">
                      <img src={`https://mc-heads.net/avatar/${player}/20`} alt="" className="w-5 h-5 rounded pixelated shrink-0" style={{ imageRendering: 'pixelated' }} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-zinc-300 font-medium">{player}</span>
                        {msgs[msgs.length - 1] && <p className="text-[10px] text-zinc-600 truncate">{msgs[msgs.length - 1].text}</p>}
                      </div>
                      <span className="text-[10px] text-zinc-600 shrink-0">{msgs.length}</span>
                    </button>
                  ))
                )}
                <div className="pt-3 border-t border-zinc-800/40 mt-3 space-y-2">
                  <input value={chatPlayer} onChange={(e) => setChatPlayer(e.target.value)} placeholder="As player..."
                    className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600" />
                  <div className="flex gap-2">
                    <input value={chatMsg} onChange={(e) => setChatMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                      placeholder="Send a message..." className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600" />
                    <button onClick={handleSendChat} disabled={!chatMsg.trim()} className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors">Send</button>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Shared sub-components ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">{title}</h2>
      {children}
    </motion.div>
  );
}

function InfoPill({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-zinc-600">{label}:</span>
      <span className={`font-medium capitalize ${mono ? 'font-mono' : ''}`} style={color ? { color } : { color: '#d4d4d8' }}>{value}</span>
    </div>
  );
}

function VitalBar({ label, value, max, color, icon }: { label: string; value: number; max: number; color: string; icon: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] text-zinc-500 w-5 shrink-0 font-medium">{icon}</span>
      <div className="flex-1 h-2.5 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} />
      </div>
      <span className="text-[11px] text-zinc-400 w-10 text-right tabular-nums font-medium">{value}/{max}</span>
    </div>
  );
}

function InventorySlot({ item, highlight }: { item: { name: string; count: number } | null; highlight?: boolean }) {
  const color = item ? getItemCategoryColorByName(item.name) : undefined;
  return (
    <div
      className="aspect-square rounded flex items-center justify-center relative group cursor-default"
      style={{
        backgroundColor: item ? `${color}08` : highlight ? '#1a1a1e' : '#141416',
        border: `1px solid ${item ? `${color}20` : highlight ? '#27272a' : '#1c1c1e'}`,
      }}
      title={item ? `${formatItemName(item.name)} x${item.count}` : 'Empty'}
    >
      {item && (
        <>
          <span className="text-[7px] text-zinc-400 text-center leading-tight truncate px-0.5">
            {item.name.replace(/_/g, ' ').split(' ').slice(-1)[0]}
          </span>
          {item.count > 1 && (
            <span className="absolute bottom-0 right-0.5 text-[7px] text-white font-bold">{item.count}</span>
          )}
        </>
      )}
    </div>
  );
}
