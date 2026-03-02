"use client";

import { useState, useEffect } from "react";

interface Stats {
  totalGames: number;
  bestLevel: number;
  avgLevel: number;
  totalXp: number;
  bestXp: number;
  totalGold: number;
}

export function LifetimeStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/stats");
      if (res.ok) {
        setStats(await res.json());
      }
    } catch {}
  };

  if (!stats || stats.totalGames === 0) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StatCard label="Games Played" value={stats.totalGames} color="text-text-bright" accent="bg-text-dim/30" />
      <StatCard label="Best Level" value={`L${stats.bestLevel}`} color="text-amber" accent="bg-amber/50" />
      <StatCard label="Avg Level" value={`L${stats.avgLevel}`} color="text-cyan" accent="bg-cyan/50" />
      <StatCard label="Total XP" value={stats.totalXp.toLocaleString()} color="text-purple" accent="bg-purple/50" />
    </div>
  );
}

function StatCard({ label, value, color, accent }: { label: string; value: string | number; color: string; accent: string }) {
  return (
    <div className="card p-4 text-center relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accent}`} />
      <div className={`text-2xl font-bold ${color} mb-1`}>{value}</div>
      <div className="text-[10px] text-text-dim uppercase tracking-wider">{label}</div>
    </div>
  );
}
