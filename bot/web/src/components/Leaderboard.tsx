"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";

interface LeaderboardEntry {
  userId: number;
  displayName: string | null;
  controllerAddr: string;
  totalGames: number;
  bestLevel: number;
  avgLevel: number;
  totalXp: number;
}

export function Leaderboard() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch("/api/leaderboard");
      if (res.ok) {
        const data = await res.json();
        setEntries(data.leaderboard);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="text-text-dim text-xs py-4">Loading leaderboard...</div>;

  // Empty state
  if (entries.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-4">
          <span className="font-display text-[11px] uppercase tracking-[0.15em] text-text-dim font-semibold">
            Leaderboard
          </span>
          <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
        </div>
        <div className="text-center py-8">
          <div className="text-2xl mb-2 opacity-30">&#9876;</div>
          <p className="text-text-dim text-xs">No adventurers have competed yet.</p>
          <p className="text-text-dim/60 text-[10px] mt-1">Be the first to enter the mountain.</p>
        </div>
      </div>
    );
  }

  const rankColors = ["text-gold", "text-[#9ca3af]", "text-[#cd7f32]"];
  const rankBg = ["bg-gold/[0.04]", "", ""];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="font-display text-[11px] uppercase tracking-[0.15em] text-text-dim font-semibold">
          Leaderboard
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
        <span className="text-[10px] text-text-dim">{entries.length} player{entries.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Top player highlight — only if more than 1 player */}
      {entries.length > 1 && entries[0] && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-gold/[0.04] border border-gold/10">
          <span className="text-gold text-lg font-bold">&#9813;</span>
          <div className="flex-1">
            <div className="text-xs text-text-bright font-semibold">
              {entries[0].displayName || `${entries[0].controllerAddr.slice(0, 6)}...${entries[0].controllerAddr.slice(-4)}`}
              {user && user.id === entries[0].userId && (
                <span className="ml-1.5 text-[9px] px-1.5 py-px rounded bg-amber/15 text-amber border border-amber/20 font-semibold">
                  you
                </span>
              )}
            </div>
            <div className="text-[10px] text-text-dim mt-0.5">
              Best <span className="text-amber font-semibold">L{entries[0].bestLevel}</span>
              {" \u00b7 "}
              <span className="text-purple font-semibold">{entries[0].totalXp.toLocaleString()}</span> XP
              {" \u00b7 "}
              {entries[0].totalGames} games
            </div>
          </div>
        </div>
      )}

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-text-dim text-left">
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border w-10">#</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border">Player</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border text-center">Games</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border text-center">Best</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border text-center">Avg</th>
            <th className="py-1.5 px-2 font-semibold text-[10px] uppercase tracking-wider border-b border-border text-right">Total XP</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const isMe = user && user.id === entry.userId;
            const name = entry.displayName || `${entry.controllerAddr.slice(0, 6)}...${entry.controllerAddr.slice(-4)}`;
            return (
              <tr
                key={entry.userId}
                className={`border-b border-border/30 transition-colors ${
                  isMe ? "bg-amber/[0.06]" : rankBg[i] || "hover:bg-bg3/30"
                }`}
              >
                <td className="py-2 px-2">
                  <span className={`font-bold ${rankColors[i] || "text-text-dim"}`}>
                    {i < 3 ? ["1st", "2nd", "3rd"][i] : i + 1}
                  </span>
                </td>
                <td className="py-2 px-2 text-text">
                  {name}
                  {isMe && (
                    <span className="ml-1.5 text-[9px] px-1.5 py-px rounded bg-amber/15 text-amber border border-amber/20 font-semibold">
                      you
                    </span>
                  )}
                </td>
                <td className="py-2 px-2 text-text text-center">{entry.totalGames}</td>
                <td className="py-2 px-2 text-amber font-semibold text-center">L{entry.bestLevel}</td>
                <td className="py-2 px-2 text-cyan text-center">L{entry.avgLevel}</td>
                <td className="py-2 px-2 text-purple font-semibold text-right">{entry.totalXp.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
