"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { SessionSetup } from "./SessionSetup";
import { PlayControls } from "./PlayControls";
import { LifetimeStats } from "./LifetimeStats";
import { GameHistory } from "./GameHistory";
import { Leaderboard } from "./Leaderboard";

interface SessionStatus {
  hasSession: boolean;
  expiresAt: number | null;
}

interface Queue {
  id: number;
  totalGames: number;
  completedGames: number;
  currentGameRequestId: number | null;
  status: string;
}

interface ResumableGame {
  id: number | null;
  gameId: number;
  hp: number;
  xp: number;
  gold: number;
  level: number;
  status: string;
  errorMessage: string | null;
  createdAt: string | null;
}

interface Props {
  resumableGames: ResumableGame[];
  onResume: (gameRequestId: number | null, gameId?: number) => void;
  onGameStarted: (queueId: number, gameRequestId: number) => void;
}

export function IdleDashboard({ resumableGames, onResume, onGameStarted }: Props) {
  const { user } = useAuth();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [resuming, setResuming] = useState<number | null>(null);

  useEffect(() => {
    if (user) {
      fetchSession();
      fetchQueue();
    }
  }, [user]);

  const fetchSession = async () => {
    try {
      const res = await fetch("/api/account/session");
      if (res.ok) setSessionStatus(await res.json());
    } catch {}
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch("/api/games/queue");
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue);
      }
    } catch {}
  };

  const handleResume = async (game: ResumableGame) => {
    const key = game.id ?? game.gameId;
    setResuming(key);
    try {
      onResume(game.id, game.gameId);
    } finally {
      setResuming(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-5 py-8 space-y-6">
        {/* Session banner — compact top bar */}
        <SessionSetup />

        {/* Resumable games alert */}
        {resumableGames.length > 0 && (
          <div className="card p-4 border-amber/20 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-green/50 to-transparent" />
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-green animate-pulse-glow" />
              <span className="text-text-bright text-xs font-semibold">
                {resumableGames.length} alive game{resumableGames.length > 1 ? "s" : ""} found
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {resumableGames.map((g) => {
                const key = g.id ?? g.gameId;
                return (
                  <button
                    key={key}
                    onClick={() => handleResume(g)}
                    disabled={resuming !== null}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green/10 text-green text-xs font-semibold border border-green/20 hover:bg-green/20 hover:border-green/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resuming === key ? (
                      "Resuming..."
                    ) : (
                      <>
                        <span className="text-text-bright">#{g.gameId}</span>
                        <span className="text-text-dim">L{g.level}</span>
                        <span className="text-green">{g.hp}HP</span>
                        <span className="text-text-dim/50">&rarr;</span>
                        <span className="text-amber">Resume</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Play controls — hero section */}
        <PlayControls
          sessionStatus={sessionStatus}
          queue={queue}
          onGameStarted={onGameStarted}
        />

        {/* Lifetime stats */}
        <LifetimeStats />

        {/* Game history */}
        <div className="card p-4">
          <GameHistory alwaysVisible />
        </div>

        {/* Leaderboard */}
        <div className="card p-4">
          <Leaderboard />
        </div>
      </div>
    </div>
  );
}
