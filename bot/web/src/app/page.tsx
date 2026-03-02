"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { ConnectWallet } from "@/components/ConnectWallet";
import { LandingHero } from "@/components/LandingHero";
import { IdleDashboard } from "@/components/IdleDashboard";
import { GameDashboard } from "@/components/GameDashboard";
import { QueueProgress } from "@/components/QueueProgress";

interface ResumableGame {
  id: number | null; // null for untracked games (started outside web app)
  gameId: number;
  hp: number;
  xp: number;
  gold: number;
  level: number;
  status: string;
  errorMessage: string | null;
  createdAt: string | null;
}

interface Queue {
  id: number;
  totalGames: number;
  completedGames: number;
  currentGameRequestId: number | null;
  status: string;
}

export default function Home() {
  const { user, loading, token, connect } = useAuth();
  const [activeGame, setActiveGame] = useState<any>(null);
  const [resumableGames, setResumableGames] = useState<ResumableGame[]>([]);
  const [queue, setQueue] = useState<Queue | null>(null);

  // Handle ?startapp= session callback
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const sessionData = params.get("startapp");
    if (sessionData) {
      handleSessionCallback(sessionData);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchActiveGame();
      fetchQueue();
    }
  }, [user]);

  // Poll while game is running
  useEffect(() => {
    if (!activeGame || !user) return;
    const interval = setInterval(fetchActiveGame, 10000);
    return () => clearInterval(interval);
  }, [activeGame, user]);

  const fetchActiveGame = async () => {
    try {
      const res = await fetch("/api/games/active");
      if (res.ok) {
        const data = await res.json();
        setActiveGame(data.active);
        setResumableGames(data.resumable || []);
      }
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

  const handleResume = async (gameRequestId: number | null, gameId?: number) => {
    try {
      const body = gameRequestId
        ? { gameRequestId }
        : { gameId };
      const res = await fetch("/api/games/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setTimeout(fetchActiveGame, 1500);
      }
    } catch {}
  };

  const handleGameStarted = (queueId: number, gameRequestId: number) => {
    setQueue((prev) => prev ? { ...prev, status: "active" } : {
      id: queueId,
      totalGames: 1,
      completedGames: 0,
      currentGameRequestId: gameRequestId,
      status: "active",
    });
    setTimeout(fetchActiveGame, 1000);
    setTimeout(fetchQueue, 1000);
  };

  const handleGameComplete = () => {
    // Refresh state — queue handler will auto-start next game if queue is active
    fetchActiveGame();
    fetchQueue();
  };

  const handleQueueEvent = (event: any) => {
    if (event.type === "queue_progress") {
      setQueue((prev) => prev ? {
        ...prev,
        completedGames: event.completedGames,
        currentGameRequestId: event.currentGameRequestId,
      } : null);
      // Refresh active game to pick up new gameRequestId
      setTimeout(fetchActiveGame, 1000);
    } else if (event.type === "queue_complete") {
      setQueue((prev) => prev ? { ...prev, status: "completed" } : null);
      // Return to idle state
      setTimeout(() => {
        setActiveGame(null);
        setQueue(null);
        fetchActiveGame();
      }, 2000);
    }
  };

  const handleSessionCallback = async (encodedSession: string) => {
    try {
      const padded = encodedSession + "=".repeat((4 - encodedSession.length % 4) % 4);
      const sessionJson = atob(padded);
      const session = JSON.parse(sessionJson);

      await fetch("/api/account/session/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerGuid: session.ownerGuid,
          expiresAt: session.expiresAt,
          sessionKeyGuid: session.sessionKeyGuid,
          guardianKeyGuid: session.guardianKeyGuid,
          metadataHash: session.metadataHash,
        }),
      });
    } catch (e) {
      console.error("Session callback error:", e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded bg-amber/20 flex items-center justify-center text-amber text-sm font-bold animate-pulse-glow">
            DM
          </div>
          <span className="text-text-dim text-xs">Loading...</span>
        </div>
      </div>
    );
  }

  // State 1: Not connected — show landing hero
  if (!user) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <header className="flex-none flex items-center justify-between px-5 py-3 border-b border-border bg-bg2/80 backdrop-blur-sm z-10 relative">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-amber/20 flex items-center justify-center text-amber text-[10px] font-bold">
              DM
            </div>
            <span className="font-display text-text-bright text-sm tracking-wide">
              Death Mountain
            </span>
          </div>
          <ConnectWallet />
        </header>
        <LandingHero onConnect={connect} />
      </div>
    );
  }

  // State 2: Connected + game running — show live dashboard
  if (activeGame) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <header className="flex-none flex items-center justify-between px-5 py-3 border-b border-border bg-bg2/80 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded bg-amber/20 flex items-center justify-center text-amber text-[10px] font-bold">
              DM
            </div>
            <span className="font-display text-text-bright text-sm tracking-wide">
              Death Mountain
            </span>
          </div>
          <ConnectWallet />
        </header>

        {queue && queue.status === "active" && (
          <QueueProgress queue={queue} />
        )}

        <div className="flex-1 min-h-0">
          <GameDashboard
            gameRequestId={activeGame.id}
            wsToken={token}
            onGameComplete={handleGameComplete}
            onQueueEvent={handleQueueEvent}
          />
        </div>
      </div>
    );
  }

  // State 3: Connected + idle — show dashboard with stats, history, play controls
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex-none flex items-center justify-between px-5 py-3 border-b border-border bg-bg2/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-amber/20 flex items-center justify-center text-amber text-[10px] font-bold">
            DM
          </div>
          <span className="font-display text-text-bright text-sm tracking-wide">
            Death Mountain
          </span>
        </div>
        <ConnectWallet />
      </header>

      <IdleDashboard
        resumableGames={resumableGames}
        onResume={handleResume}
        onGameStarted={handleGameStarted}
      />
    </div>
  );
}
