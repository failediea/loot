"use client";

import { useState, useEffect } from "react";

interface GameHistoryItem {
  requestId: number;
  gameId: number | null;
  status: string;
  botName: string;
  createdAt: string;
  completedAt: string | null;
  level: number | null;
  xp: number | null;
  gold: number | null;
  causeOfDeath: string | null;
}

interface Props {
  alwaysVisible?: boolean;
}

export function GameHistory({ alwaysVisible = false }: Props) {
  const [games, setGames] = useState<GameHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/games/history");
      if (res.ok) {
        const data = await res.json();
        setGames(data.games);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="text-text-dim text-xs py-2">Loading history...</div>;
  if (games.length === 0) return <div className="text-text-dim text-xs py-2">No games played yet.</div>;

  const completedGames = games.filter((g) => g.level !== null);
  const avgLevel = completedGames.length > 0
    ? (completedGames.reduce((s, g) => s + (g.level || 0), 0) / completedGames.length).toFixed(1)
    : "0";
  const bestLevel = completedGames.length > 0
    ? Math.max(...completedGames.map((g) => g.level || 0))
    : 0;

  // Only show games with actual results, hide failed stubs unless no other games
  const visibleGames = completedGames.length > 0
    ? games.filter((g) => g.status !== "failed" || g.gameId !== null)
    : games;

  return (
    <div className="animate-fade-in">
      {/* Stats summary — only in collapsible mode */}
      {!alwaysVisible && completedGames.length > 0 && (
        <div className="flex items-center gap-4 mb-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim">Games</span>
            <span className="text-text-bright font-semibold">{completedGames.length}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim">Avg</span>
            <span className="text-cyan font-semibold">L{avgLevel}</span>
          </div>
          <div className="w-px h-3 bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-text-dim">Best</span>
            <span className="text-amber font-semibold">L{bestLevel}</span>
          </div>
        </div>
      )}

      {alwaysVisible && (
        <div className="flex items-center gap-2 mb-3">
          <span className="font-display text-[11px] uppercase tracking-[0.15em] text-text-dim font-semibold">
            Game History
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
          {completedGames.length > 0 && (
            <span className="text-[10px] text-text-dim">
              {completedGames.length} run{completedGames.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-text-dim text-left">
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border">Game</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border">Level</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border">XP</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border">Gold</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border">Cause of Death</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border text-right">When</th>
          </tr>
        </thead>
        <tbody>
          {visibleGames.map((g) => {
            const levelPct = bestLevel > 0 && g.level ? Math.round((g.level / bestLevel) * 100) : 0;
            const isBest = g.level === bestLevel && bestLevel > 0;
            return (
              <tr key={g.requestId} className={`border-b border-border/30 hover:bg-bg3/30 transition-colors ${isBest ? "bg-amber/[0.03]" : ""}`}>
                <td className="py-2 px-2 text-text font-mono">{g.gameId ? `#${g.gameId}` : "\u2014"}</td>
                <td className="py-2 px-2">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${isBest ? "text-amber" : "text-text-bright"}`}>
                      {g.level !== null ? `L${g.level}` : "\u2014"}
                    </span>
                    {g.level !== null && bestLevel > 0 && (
                      <div className="w-12 h-1 rounded-full bg-border/50 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isBest ? "bg-amber/60" : "bg-text-dim/40"}`}
                          style={{ width: `${levelPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>
                <td className="py-2 px-2 text-cyan">{g.xp ?? "\u2014"}</td>
                <td className="py-2 px-2 text-gold">{g.gold ?? "\u2014"}</td>
                <td className="py-2 px-2 text-text-dim text-[11px]">{prettifyDeath(g.causeOfDeath)}</td>
                <td className="py-2 px-2 text-right text-[10px] text-text-dim">
                  {timeAgo(g.completedAt || g.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Clean up raw cause-of-death strings into human-friendly text */
function prettifyDeath(raw: string | null): string {
  if (!raw) return "\u2014";
  if (raw.includes("Killed in battle")) return "Slain in battle";
  if (raw.includes("Died during shopping")) return "Died while shopping";
  if (raw.includes("recovered")) return "Died (recovered)";
  if (raw.includes("exploring") || raw.includes("obstacle")) return "Killed by obstacle";
  if (raw.includes("Game not found")) return "Game not found";
  return raw;
}

/** Convert ISO date string to relative time ("2h ago", "3d ago", etc.) */
function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green/10 text-green border-green/20",
    running: "bg-blue/10 text-blue border-blue/20",
    queued: "bg-yellow/10 text-yellow border-yellow/20",
    failed: "bg-red/10 text-red border-red/20",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${styles[status] || "text-text-dim"}`}>
      {status}
    </span>
  );
}
