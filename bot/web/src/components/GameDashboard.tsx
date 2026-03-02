"use client";

import { useState, useEffect, useRef } from "react";

// --- Types matching bot/src/dashboard/events.ts ---

interface Stats {
  strength: number;
  dexterity: number;
  vitality: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

interface EnrichedItem {
  id: number;
  xp: number;
  name: string;
  tier: number;
  slot: string;
  greatness: number;
}

interface EnrichedBeast {
  id: number;
  name: string;
  type: string;
  tier: number;
  level: number;
  health: number;
}

interface StateUpdate {
  type: "state_update";
  ts: number;
  gameId: number;
  phase: string;
  adventurer: {
    health: number;
    maxHealth: number;
    xp: number;
    level: number;
    gold: number;
    stats: Stats;
    equipment: Record<string, EnrichedItem>;
    bag: EnrichedItem[];
    statUpgrades: number;
  };
  beast: EnrichedBeast | null;
  marketSize: number;
}

interface CombatSim {
  type: "combat_sim";
  ts: number;
  beast: EnrichedBeast;
  winRate: number;
  expectedHpLoss: number;
  expectedHpLossOnWin: number;
  expectedRounds: number;
  deathRate: number;
  fleeChance: number;
  isProfitable: boolean;
  netHpCost: number;
  killGold: number;
  killXp: number;
}

type DashboardEvent = any;

interface Props {
  gameRequestId: number | null;
  wsToken: string | null;
  onGameComplete?: () => void;
  onQueueEvent?: (event: any) => void;
}

// --- Component ---

interface GameSummaryData {
  gameId: number;
  summary: {
    gameId: number;
    level: number;
    xp: number;
    gold: number;
    causeOfDeath: string;
    lastPhase: string;
    lastAction: string;
    stats: Stats;
  };
}

export function GameDashboard({ gameRequestId, wsToken, onGameComplete, onQueueEvent }: Props) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<StateUpdate | null>(null);
  const [combatSim, setCombatSim] = useState<CombatSim | null>(null);
  const [gameSummary, setGameSummary] = useState<GameSummaryData | null>(null);
  const [log, setLog] = useState<DashboardEvent[]>([]);
  const [txHistory, setTxHistory] = useState<any[]>([]);
  const [gameStartTime] = useState<number>(Date.now());
  const [elapsed, setElapsed] = useState("0:00");
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Game duration timer
  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.floor((Date.now() - gameStartTime) / 1000);
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [gameStartTime]);

  // Reset state when switching games in a queue
  useEffect(() => {
    setState(null);
    setCombatSim(null);
    setGameSummary(null);
    setLog([]);
    setTxHistory([]);
  }, [gameRequestId]);

  useEffect(() => {
    if (!wsToken || !gameRequestId) return;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connectWs() {
      if (disposed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws?token=${wsToken}`);

      ws.onopen = () => {
        if (disposed) { ws.close(); return; }
        setConnected(true);
        ws.send(JSON.stringify({ type: "join_game", gameRequestId }));
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        reconnectTimer = setTimeout(connectWs, 3000);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        handleEvent(data);
      };

      wsRef.current = ws;
    }

    connectWs();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [wsToken, gameRequestId]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const handleEvent = (ev: DashboardEvent) => {
    switch (ev.type) {
      case "state_update":
        setState(ev);
        break;
      case "combat_sim":
        setCombatSim(ev);
        addLog(ev);
        break;
      case "decision":
      case "market_action":
      case "stat_allocation":
      case "game_start":
        addLog(ev);
        break;
      case "game_summary":
        setGameSummary(ev);
        addLog(ev);
        // Notify parent after a delay so user can see the death banner
        if (onGameComplete) {
          setTimeout(onGameComplete, 3000);
        }
        break;
      case "queue_progress":
      case "queue_complete":
        addLog(ev);
        if (onQueueEvent) onQueueEvent(ev);
        break;
      case "tx_status":
        handleTx(ev);
        // Only show errors in the activity log — normal TX flow is in the TX panel
        if (ev.status === "error" || ev.status === "reverted") {
          addLog(ev);
        }
        break;
      case "connected":
        break;
    }
  };

  const addLog = (ev: DashboardEvent) => {
    setLog((prev) => [...prev.slice(-299), ev]);
  };

  const handleTx = (ev: any) => {
    setTxHistory((prev) => {
      const existing = prev.findIndex(
        (t) => t.description === ev.description && !["confirmed", "reverted", "error"].includes(t.status)
      );
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], ...ev };
        return updated;
      }
      return [ev, ...prev].slice(0, 10);
    });
  };

  if (!gameRequestId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center animate-fade-in">
          <div className="text-3xl text-text-dim/30 mb-3">&#9876;</div>
          <p className="text-text-dim text-sm">No active game</p>
          <p className="text-text-dim/60 text-xs mt-1">Click Play Game to start</p>
        </div>
      </div>
    );
  }

  // Connected but no state yet — game is starting or resuming
  if (!state && connected) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center animate-fade-in">
          <div className="w-10 h-10 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center text-amber text-lg mx-auto mb-4 animate-pulse-glow">
            &#9876;
          </div>
          <p className="text-amber text-sm font-semibold mb-1">Connecting to game...</p>
          <p className="text-text-dim/60 text-xs">Waiting for game state</p>
        </div>
      </div>
    );
  }

  if (!state && !connected) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center animate-fade-in">
          <div className="w-10 h-10 rounded-lg bg-red/10 border border-red/20 flex items-center justify-center text-red text-lg mx-auto mb-4">
            &#9888;
          </div>
          <p className="text-red text-sm font-semibold mb-1">Connection lost</p>
          <p className="text-text-dim/60 text-xs">Attempting to reconnect...</p>
        </div>
      </div>
    );
  }

  const adv = state?.adventurer;
  const hpPct = adv ? (adv.health / adv.maxHealth) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3 bg-bg2/60 border-b border-border/50 flex-wrap">
        <h2 className="font-display text-text-bright font-semibold text-sm tracking-wide">
          Loot Survivor
        </h2>
        {state && (
          <div className="flex items-center gap-2.5">
            <span className="text-xs px-2.5 py-1 rounded bg-blue/10 text-blue border border-blue/15">
              #{state.gameId}
            </span>
            <span className="text-xs px-2.5 py-1 rounded bg-amber/10 text-amber border border-amber/15 font-semibold">
              L{adv?.level}
            </span>
            <PhaseTag phase={state.phase} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-4">
          <span className="text-[10px] text-text-dim tabular-nums">{elapsed}</span>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${connected ? "bg-green" : "bg-red"}`}
            />
            <span className={`text-[10px] ${connected ? "text-green/70" : "text-red/70"}`}>
              {connected ? "Live" : "Offline"}
            </span>
          </div>
        </div>
      </div>

      {/* Death Banner */}
      {gameSummary && (
        <DeathBanner summary={gameSummary.summary} />
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-[300px_1fr_320px] flex-1 min-h-0 gap-3 p-3">
        {/* Left: Adventurer */}
        <div className="card overflow-y-auto p-4">
          <SectionTitle>Adventurer</SectionTitle>

          {/* HP Bar */}
          <HpBar hp={adv?.health ?? 0} maxHp={adv?.maxHealth ?? 100} pct={hpPct} />

          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <QuickStat label="XP" value={adv?.xp ?? 0} color="text-cyan" />
            <QuickStat label="Gold" value={adv?.gold ?? 0} color="text-gold" />
            <QuickStat label="Upgrades" value={adv?.statUpgrades ?? 0} color="text-blue" />
          </div>

          {/* Stats */}
          <SectionTitle>Stats</SectionTitle>
          {adv && <StatsGrid stats={adv.stats} level={adv.level} />}

          {/* Equipment */}
          <SectionTitle>Equipment</SectionTitle>
          {adv && <EquipmentList equipment={adv.equipment} />}

          {/* Bag */}
          <details className="mt-3 group">
            <summary className="text-[10px] uppercase tracking-[0.15em] text-text-dim cursor-pointer flex items-center gap-2 py-1 hover:text-text transition-colors">
              <span className="text-[8px] group-open:rotate-90 transition-transform">&#9654;</span>
              Bag {adv?.bag && adv.bag.length > 0 && <span className="text-text-dim/50">({adv.bag.length})</span>}
            </summary>
            <div className="mt-1.5">
              {adv?.bag && adv.bag.length > 0 ? (
                adv.bag.map((item, i) => <ItemRow key={i} item={item} />)
              ) : (
                <span className="text-text-dim/60 text-xs">Empty</span>
              )}
            </div>
          </details>
        </div>

        {/* Center: Activity */}
        <div className="card flex flex-col min-h-0 p-4">
          {/* Beast Panel */}
          {state?.beast && state.beast.id > 0 && (state.phase === "in_battle" || state.phase === "starter_beast") && (
            <BeastPanel beast={state.beast} combatSim={combatSim} />
          )}

          <SectionTitle>Activity Log</SectionTitle>
          <div className="flex-1 overflow-y-auto pr-1 space-y-0.5">
            {log.map((ev, i) => (
              <LogEntry key={i} event={ev} />
            ))}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Right: TX Monitor */}
        <div className="card overflow-y-auto p-4">
          <SectionTitle>Transactions</SectionTitle>
          <div className="space-y-2">
            {txHistory.map((tx, i) => (
              <TxEntry key={i} tx={tx} />
            ))}
          </div>
          {txHistory.length === 0 && (
            <div className="text-center py-6">
              <p className="text-text-dim/50 text-xs">No transactions yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span className="font-display text-[11px] uppercase tracking-[0.15em] text-text-dim font-semibold">
        {children}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

function PhaseTag({ phase }: { phase: string }) {
  const styles: Record<string, string> = {
    exploring: "bg-green/10 text-green border-green/20",
    in_battle: "bg-red/10 text-red border-red/20",
    starter_beast: "bg-red/10 text-red border-red/20",
    shopping: "bg-gold/10 text-gold border-gold/20",
    stat_upgrade: "bg-blue/10 text-blue border-blue/20",
    dead: "bg-bg3 text-text-dim border-border",
    idle: "bg-bg3 text-text-dim border-border",
  };
  return (
    <span className={`text-[10px] px-2.5 py-1 rounded border font-semibold uppercase tracking-wider ${styles[phase] || "bg-bg3 text-text-dim border-border"}`}>
      {phase.replace(/_/g, " ")}
    </span>
  );
}

function HpBar({ hp, maxHp, pct }: { hp: number; maxHp: number; pct: number }) {
  const getBarStyle = () => {
    if (pct > 60) return {
      bg: "linear-gradient(90deg, #059669, #10b981)",
      shadow: "0 0 12px rgba(16, 185, 129, 0.25)",
      cls: "",
    };
    if (pct > 30) return {
      bg: "linear-gradient(90deg, #d97706, #eab308)",
      shadow: "0 0 12px rgba(234, 179, 8, 0.25)",
      cls: "",
    };
    return {
      bg: "linear-gradient(90deg, #dc2626, #ef4444)",
      shadow: "0 0 16px rgba(239, 68, 68, 0.3)",
      cls: "animate-health-critical",
    };
  };

  const style = getBarStyle();

  return (
    <div className={`relative h-7 bg-bg3/60 rounded-md border border-border overflow-hidden mb-3 ${style.cls}`}>
      <div
        className="h-full rounded-md transition-all duration-700 ease-out"
        style={{
          width: `${pct}%`,
          background: style.bg,
          boxShadow: style.shadow,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold tracking-wider" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,1)' }}>
          <span className="text-text-bright">{hp}</span>
          <span className="text-text-bright/50 mx-0.5">/</span>
          <span className="text-text-bright/50">{maxHp}</span>
        </span>
      </div>
    </div>
  );
}

function QuickStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-bg/50 rounded-md border border-border/50 px-2.5 py-2 text-center">
      <div className={`text-sm font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-text-dim uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function StatsGrid({ stats, level }: { stats: Stats; level: number }) {
  const items: [string, number, string][] = [
    ["STR", stats.strength, "bg-red"],
    ["DEX", stats.dexterity, "bg-green"],
    ["VIT", stats.vitality, "bg-amber"],
    ["INT", stats.intelligence, "bg-blue"],
    ["WIS", stats.wisdom, "bg-purple"],
    ["CHA", stats.charisma, "bg-gold"],
  ];

  const maxStat = Math.max(...items.map(([, v]) => v), 10);

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3">
      {items.map(([label, value, barColor]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-[10px] text-text-dim w-7 font-semibold">{label}</span>
          <div className="flex-1 h-1.5 bg-bg/60 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor} transition-all duration-500`}
              style={{ width: `${Math.min(100, (value / maxStat) * 100)}%`, opacity: value === 0 ? 0.15 : 0.7 }}
            />
          </div>
          <span className="text-xs text-text-bright font-semibold w-5 text-right">{value}</span>
        </div>
      ))}
    </div>
  );
}

function EquipmentList({ equipment }: { equipment: Record<string, EnrichedItem> }) {
  const slots = ["weapon", "chest", "head", "waist", "foot", "hand", "neck", "ring"];

  return (
    <div className="space-y-1 mb-1">
      {slots.map((slot) => {
        const item = equipment[slot];
        const isEmpty = !item || item.id === 0;
        const tierColor = getTierBorderColor(item?.tier);

        return (
          <div
            key={slot}
            className={`flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors ${
              isEmpty ? "bg-transparent" : "bg-bg/40"
            }`}
            style={isEmpty ? {} : { borderLeft: `2px solid ${tierColor}` }}
          >
            <span className="w-11 text-[9px] text-text-dim uppercase tracking-wider font-semibold">
              {slot}
            </span>
            {isEmpty ? (
              <span className="text-text-dim/30 text-xs">&mdash;</span>
            ) : (
              <>
                <span className="flex-1 text-xs text-text">{item.name}</span>
                <TierBadge tier={item.tier} />
                <GreatnessBar greatness={item.greatness} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getTierBorderColor(tier?: number): string {
  switch (tier) {
    case 1: return "#d4a020";
    case 2: return "#9ca3af";
    case 3: return "#10b981";
    case 4: return "#60a5fa";
    case 5: return "#4b5563";
    default: return "#1c2840";
  }
}

function ItemRow({ item }: { item: EnrichedItem }) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 rounded-md bg-bg/30" style={{ borderLeft: `2px solid ${getTierBorderColor(item.tier)}` }}>
      <span className="w-12 text-[10px] text-text-dim uppercase tracking-wider">{item.slot}</span>
      <span className="flex-1 text-xs text-text">{item.name}</span>
      <TierBadge tier={item.tier} />
      <span className="text-[10px] text-text-dim">G{item.greatness}</span>
    </div>
  );
}

function TierBadge({ tier }: { tier: number }) {
  const styles: Record<number, string> = {
    1: "bg-gold/15 text-gold border-gold/25",
    2: "bg-gray-400/10 text-gray-400 border-gray-500/20",
    3: "bg-green/10 text-green border-green/20",
    4: "bg-blue/10 text-blue border-blue/20",
    5: "bg-bg text-text-dim border-border",
  };
  return (
    <span className={`text-[9px] px-1.5 py-px rounded border font-bold ${styles[tier] || "bg-bg text-text-dim border-border"}`}>
      T{tier}
    </span>
  );
}

function GreatnessBar({ greatness }: { greatness: number }) {
  const pct = Math.min(100, (greatness / 20) * 100);
  const color = greatness >= 20 ? "#d4a020" : greatness >= 15 ? "#a78bfa" : "#60a5fa";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-10 h-1 bg-bg/60 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[9px] text-text-dim w-5">G{greatness}</span>
    </div>
  );
}

function BeastPanel({ beast, combatSim }: { beast: EnrichedBeast; combatSim: CombatSim | null }) {
  const typeIcons: Record<string, string> = {
    Magic: "\u2728", Blade: "\u2694", Bludgeon: "\ud83d\udd28",
    Cloth: "\ud83e\uddf5", Hide: "\ud83e\ude76", Metal: "\ud83d\udee1",
  };
  return (
    <div className="mb-3 rounded-lg border border-red/20 bg-red/[0.03] p-4 glow-red animate-fade-in">
      <div className="flex justify-between items-start mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-red/60 text-lg">&#9760;</span>
            <span className="font-display font-bold text-red text-base tracking-wide text-glow-red">
              {beast.name}
            </span>
            <TierBadge tier={beast.tier} />
          </div>
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <span>Level {beast.level}</span>
            <span className="text-text-dim/30">&middot;</span>
            <span>{typeIcons[beast.type] || ""} {beast.type}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-red font-bold text-lg tabular-nums">{beast.health}</div>
          <div className="text-[9px] text-text-dim/60 uppercase tracking-wider">HP</div>
        </div>
      </div>
      {combatSim && <CombatSimReadout sim={combatSim} />}
    </div>
  );
}

function CombatSimReadout({ sim }: { sim: CombatSim }) {
  const winColor = sim.winRate >= 0.7 ? "text-green" : sim.winRate >= 0.4 ? "text-yellow" : "text-red";

  return (
    <div className="grid grid-cols-4 gap-2 pt-2 border-t border-red/10">
      <SimStat label="Win" value={`${(sim.winRate * 100).toFixed(0)}%`} cls={winColor} />
      <SimStat label="Flee" value={`${(sim.fleeChance * 100).toFixed(0)}%`} />
      <SimStat label="HP Loss" value={sim.expectedHpLossOnWin.toFixed(0)} />
      <SimStat label="Rounds" value={sim.expectedRounds.toFixed(1)} />
      <SimStat
        label="Profit"
        value={sim.isProfitable ? "YES" : "NO"}
        cls={sim.isProfitable ? "text-green" : "text-red"}
      />
      <SimStat label="Gold" value={`${sim.killGold}g`} cls="text-gold" />
      <SimStat label="XP" value={`${sim.killXp}`} cls="text-cyan" />
      <SimStat
        label="Death"
        value={`${(sim.deathRate * 100).toFixed(0)}%`}
        cls={sim.deathRate > 0.3 ? "text-red" : ""}
      />
    </div>
  );
}

function SimStat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="text-center">
      <div className={`text-xs font-semibold ${cls || "text-text"}`}>{value}</div>
      <div className="text-[9px] text-text-dim/60 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function LogEntry({ event }: { event: DashboardEvent }) {
  const tag = getTag(event);
  const msg = getMessage(event);
  const time = new Date(event.ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className="flex gap-2 py-1.5 px-2 rounded text-xs hover:bg-bg3/20 transition-colors"
      style={{ borderLeft: `2px solid ${tag.borderColor}` }}
    >
      <span className="text-text-dim/50 text-[10px] whitespace-nowrap min-w-[52px] tabular-nums">{time}</span>
      <span className={`text-[9px] px-1.5 py-px rounded border font-bold whitespace-nowrap self-start mt-px ${tag.cls}`}>
        {tag.label}
      </span>
      <span className="flex-1 break-words text-text/80 leading-relaxed">{msg}</span>
    </div>
  );
}

function getTag(ev: DashboardEvent): { label: string; cls: string; borderColor: string } {
  switch (ev.type) {
    case "combat_sim": return { label: "COMBAT", cls: "bg-red/10 text-red border-red/20", borderColor: "#ef4444" };
    case "decision":
      if (ev.phase === "in_battle" || ev.phase === "starter_beast") return { label: "COMBAT", cls: "bg-red/10 text-red border-red/20", borderColor: "#ef4444" };
      if (ev.phase === "exploring") return { label: "EXPLORE", cls: "bg-green/10 text-green border-green/20", borderColor: "#10b981" };
      if (ev.phase === "shopping") return { label: "SHOP", cls: "bg-gold/10 text-gold border-gold/20", borderColor: "#d4a020" };
      if (ev.phase === "stat_upgrade") return { label: "STATS", cls: "bg-blue/10 text-blue border-blue/20", borderColor: "#60a5fa" };
      return { label: "DECIDE", cls: "bg-cyan/10 text-cyan border-cyan/20", borderColor: "#22d3ee" };
    case "market_action": return { label: "SHOP", cls: "bg-gold/10 text-gold border-gold/20", borderColor: "#d4a020" };
    case "stat_allocation": return { label: "STATS", cls: "bg-blue/10 text-blue border-blue/20", borderColor: "#60a5fa" };
    case "tx_status":
      if (ev.status === "error" || ev.status === "reverted") return { label: "TX ERR", cls: "bg-red/15 text-red border-red/25", borderColor: "#ef4444" };
      return { label: "TX", cls: "bg-purple/10 text-purple border-purple/20", borderColor: "#a78bfa" };
    case "game_start": return { label: "GAME", cls: "bg-amber/10 text-amber border-amber/20", borderColor: "#f59e0b" };
    case "game_summary": return { label: "GAME", cls: "bg-amber/10 text-amber border-amber/20", borderColor: "#f59e0b" };
    default: return { label: "INFO", cls: "bg-bg3 text-text-dim border-border", borderColor: "#1c2840" };
  }
}

function getMessage(ev: DashboardEvent): string {
  switch (ev.type) {
    case "decision": return prettifyDecision(ev.action, ev.reason);
    case "combat_sim":
      return `Win: ${(ev.winRate * 100).toFixed(0)}% | Flee: ${(ev.fleeChance * 100).toFixed(0)}% | HP Loss: ${ev.expectedHpLossOnWin.toFixed(0)} | ${ev.isProfitable ? "Profitable" : "Unprofitable"}`;
    case "market_action": {
      const parts: string[] = [];
      if (ev.potions > 0) parts.push(`${ev.potions} potion${ev.potions > 1 ? "s" : ""}`);
      ev.items?.forEach((i: any) => parts.push(`${i.name} (T${i.tier})`));
      return parts.length > 0
        ? `Bought ${parts.join(", ")} \u2014 ${ev.totalCost}g spent, ${ev.goldRemaining}g left${ev.savingForWeapon ? " (saving for weapon)" : ""}`
        : `Nothing bought (${ev.goldRemaining}g left)`;
    }
    case "stat_allocation": {
      const a = ev.allocation;
      const sp: string[] = [];
      if (a.strength) sp.push(`+${a.strength} STR`);
      if (a.dexterity) sp.push(`+${a.dexterity} DEX`);
      if (a.vitality) sp.push(`+${a.vitality} VIT`);
      if (a.intelligence) sp.push(`+${a.intelligence} INT`);
      if (a.wisdom) sp.push(`+${a.wisdom} WIS`);
      if (a.charisma) sp.push(`+${a.charisma} CHA`);
      return `Allocated ${ev.points} points: ${sp.join(", ")}`;
    }
    case "tx_status": {
      const desc = prettifyAction(ev.description);
      if (ev.status === "error" || ev.status === "reverted") {
        return `TX failed: ${desc} \u2014 ${ev.error?.slice(0, 80) || "unknown error"}`;
      }
      return `[${ev.status.toUpperCase()}] ${desc}`;
    }
    case "game_start": return `Game #${ev.gameId} started`;
    case "game_summary":
      return `Game over \u2014 Level ${ev.summary.level}, ${ev.summary.xp} XP \u2014 ${ev.summary.causeOfDeath}`;
    default: return JSON.stringify(ev).slice(0, 120);
  }
}

/** Clean up raw action strings into readable text */
function prettifyAction(action: string): string {
  if (!action) return action;
  return action
    .replace(/explore\(till_beast=false\)/g, "Explore")
    .replace(/explore\(till_beast=true\)/g, "Explore (till beast)")
    .replace(/attack\(to_the_death=true\)/g, "Attack (to the death)")
    .replace(/attack\(to_the_death=false\)/g, "Attack")
    .replace(/flee\(to_the_death=true\)/g, "Flee (to the death)")
    .replace(/flee\(to_the_death=false\)/g, "Flee")
    .replace(/equip\(\[([^\]]+)\]\)/g, "Equip items [$1]")
    .replace(/buy_items\(potions=(\d+), items=(\d+)\)/g, "Buy ($1 potions, $2 items)")
    .replace(/select_stat_upgrades/g, "Allocate stats")
    .replace(/skip_market/g, "Skip market")
    .replace(/buy_game/g, "Buy game")
    .replace(/start_game\+attack_starter/g, "Start game");
}

function prettifyDecision(action: string, reason: string): string {
  const cleanAction = prettifyAction(action);
  // Shorten verbose reasons
  let cleanReason = reason
    .replace(/Exploring single step \(HP: (\d+)\/(\d+)\) — heal between encounters/, "HP $1/$2")
    .replace(/Marginal (\d+)% win, fleeing \(.*\)/, "Marginal $1% win \u2014 too risky")
    .replace(/\d+% win rate, (attacking|fleeing).*/, (_, verb) => `${verb === "attacking" ? "Attacking" : "Fleeing"}`)
    .replace(/Allocating (\d+) stat points/, "$1 stat points available");
  return `${cleanAction} \u2014 ${cleanReason}`;
}

function DeathBanner({ summary }: { summary: GameSummaryData["summary"] }) {
  const statItems: [string, number][] = [
    ["STR", summary.stats.strength],
    ["DEX", summary.stats.dexterity],
    ["VIT", summary.stats.vitality],
    ["INT", summary.stats.intelligence],
    ["WIS", summary.stats.wisdom],
    ["CHA", summary.stats.charisma],
  ];

  return (
    <div className="flex-none mx-3 mt-3 rounded-lg border border-red/30 bg-red/[0.04] p-4 animate-fade-in glow-red">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="text-red text-2xl">&#9760;</span>
          <div>
            <h3 className="font-display font-bold text-red text-sm tracking-wide text-glow-red">
              Adventurer Has Fallen
            </h3>
            <p className="text-text-dim text-xs mt-0.5">{summary.causeOfDeath}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="text-center">
            <div className="text-amber font-bold text-base">L{summary.level}</div>
            <div className="text-text-dim/60 text-[9px] uppercase tracking-wider">Level</div>
          </div>
          <div className="text-center">
            <div className="text-cyan font-bold text-base">{summary.xp}</div>
            <div className="text-text-dim/60 text-[9px] uppercase tracking-wider">XP</div>
          </div>
          <div className="text-center">
            <div className="text-gold font-bold text-base">{summary.gold}</div>
            <div className="text-text-dim/60 text-[9px] uppercase tracking-wider">Gold</div>
          </div>
          <div className="hidden sm:flex items-center gap-2 ml-2 pl-4 border-l border-red/15">
            {statItems.map(([label, value]) => (
              <span key={label} className="text-text-dim text-[10px]">
                <span className="text-text-dim/50">{label}</span>{" "}
                <span className="text-text font-semibold">{value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TxEntry({ tx }: { tx: any }) {
  const statusConfig: Record<string, { cls: string; borderColor: string }> = {
    submitting: { cls: "bg-yellow/10 text-yellow border-yellow/20", borderColor: "#eab308" },
    submitted: { cls: "bg-purple/10 text-purple border-purple/20", borderColor: "#a78bfa" },
    confirmed: { cls: "bg-green/10 text-green border-green/20", borderColor: "#10b981" },
    reverted: { cls: "bg-red/10 text-red border-red/20", borderColor: "#ef4444" },
    error: { cls: "bg-red/15 text-red border-red/25", borderColor: "#ef4444" },
  };

  const config = statusConfig[tx.status] || { cls: "bg-bg3 text-text-dim border-border", borderColor: "#1c2840" };

  return (
    <div
      className="rounded-md bg-bg/40 p-2.5 text-xs animate-fade-in"
      style={{ borderLeft: `2px solid ${config.borderColor}` }}
    >
      <div className="flex justify-between items-center mb-1">
        <span className={`text-[9px] px-1.5 py-px rounded border font-bold uppercase ${config.cls}`}>
          {tx.status}
        </span>
        {tx.txHash && (
          <a
            href={`https://starkscan.co/tx/${tx.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue/70 text-[10px] hover:text-blue transition-colors"
          >
            {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-6)}
          </a>
        )}
      </div>
      <div className="text-text/70 leading-relaxed">{tx.description}</div>
      {tx.error && <div className="text-red/80 text-[10px] mt-1">{tx.error.slice(0, 100)}</div>}
    </div>
  );
}
