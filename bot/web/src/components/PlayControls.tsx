"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";

interface Queue {
  id: number;
  totalGames: number;
  completedGames: number;
  currentGameRequestId: number | null;
  status: string;
}

interface Props {
  sessionStatus: { hasSession: boolean; expiresAt: number | null } | null;
  queue: Queue | null;
  onGameStarted: (queueId: number, gameRequestId: number) => void;
}

export function PlayControls({ sessionStatus, queue, onGameStarted }: Props) {
  const { user, username } = useAuth();
  const [count, setCount] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingUpSession, setSettingUpSession] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [ticketUsd, setTicketUsd] = useState<number | null>(null);
  const [strkUsd, setStrkUsd] = useState<number | null>(null);

  const needsSession = !sessionStatus?.hasSession ||
    (sessionStatus.expiresAt != null && sessionStatus.expiresAt < Date.now() / 1000);

  // Fetch STRK balance and live prices from Ekubo
  useEffect(() => {
    if (user) fetchBalance();
    fetchPrices();
  }, [user]);

  const fetchBalance = async () => {
    try {
      const res = await fetch("/api/account/balance");
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balanceFormatted);
      }
    } catch {}
  };

  const fetchPrices = async () => {
    try {
      const res = await fetch("/api/price/strk");
      if (res.ok) {
        const data = await res.json();
        if (data.ticketUsd) setTicketUsd(data.ticketUsd);
        if (data.strkUsd) setStrkUsd(data.strkUsd);
      }
    } catch {}
  };

  const handleSetupSession = async () => {
    setSettingUpSession(true);
    setError(null);
    try {
      const res = await fetch("/api/account/session/init", { method: "POST" });
      if (!res.ok) throw new Error("Failed to initialize session");
      const { keychainUrl } = await res.json();
      window.location.href = keychainUrl;
    } catch (e: any) {
      setError(e.message);
      setSettingUpSession(false);
    }
  };

  const handlePlay = async () => {
    if (needsSession) {
      handleSetupSession();
      return;
    }

    setRequesting(true);
    setError(null);
    try {
      const name = username || user?.address?.slice(0, 8) || "BOT";
      const res = await fetch("/api/games/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, botName: name.toUpperCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to start games");
      }

      onGameStarted(data.queueId, data.gameRequestId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRequesting(false);
    }
  };

  const handleCountChange = (value: string) => {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 1) {
      setCount(1);
    } else if (n > 50) {
      setCount(50);
    } else {
      setCount(n);
    }
  };

  // Show active queue status
  if (queue && queue.status === "active") {
    return (
      <div className="card p-6 glow-green">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-2.5 h-2.5 rounded-full bg-green animate-pulse-glow" />
          <span className="font-display font-semibold text-green text-base tracking-wide">
            Game {(queue.completedGames || 0) + 1} of {queue.totalGames}
          </span>
        </div>
        <div className="text-text-dim text-xs text-center">Queue is running &mdash; view live dashboard below</div>
      </div>
    );
  }

  const buttonText = settingUpSession
    ? "Setting up session..."
    : requesting
    ? "Starting..."
    : needsSession
    ? "Set Up Session to Play"
    : count === 1
    ? "Play Game"
    : `Play ${count} Games`;

  const formatUsd = (v: number) => v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`;

  return (
    <div className="card p-6 relative overflow-hidden">
      {/* Subtle top accent */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber/30 to-transparent" />

      {/* Header */}
      <div className="text-center mb-5">
        <h2 className="font-display text-text-bright text-base font-semibold tracking-wide mb-1">
          Deploy Your Adventurer
        </h2>
        <p className="text-text-dim text-[11px]">
          Game Price:{" "}
          <span className="text-text font-semibold">
            {ticketUsd !== null ? formatUsd(ticketUsd) : "..."}
          </span>
          <span className="text-text-dim"> &middot; pay with any token</span>
        </p>
      </div>

      {/* Game count input */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <label className="text-xs text-text-dim">Games</label>
        <input
          type="number"
          min={1}
          max={50}
          value={count}
          onChange={(e) => handleCountChange(e.target.value)}
          className="w-20 h-12 rounded-lg text-center text-lg font-bold bg-bg3/80 text-amber border-2 border-border focus:border-amber/50 focus:outline-none transition-colors appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {!user?.isOwner && ticketUsd !== null && (
          <span className="text-xs text-text-dim">
            {formatUsd(count * ticketUsd)}
          </span>
        )}
      </div>

      {/* Play button — prominent CTA */}
      <button
        onClick={handlePlay}
        disabled={requesting || settingUpSession}
        className="w-full py-3.5 rounded-lg bg-green/15 text-green font-display font-bold text-base tracking-wide hover:bg-green/25 transition-all duration-200 border border-green/30 hover:border-green/50 disabled:opacity-50 disabled:cursor-not-allowed glow-green"
      >
        {buttonText}
      </button>

      {/* Footer info */}
      <div className="flex items-center justify-center gap-4 mt-3">
        {user?.isOwner && (
          <span className="text-[10px] text-amber/70 tracking-wider uppercase font-semibold">
            Owner &mdash; free play
          </span>
        )}
        {balance !== null && (
          <span className="text-[10px] text-text-dim">
            Balance:{" "}
            <span className="text-text font-semibold">
              {strkUsd !== null
                ? `${formatUsd(parseFloat(balance) * strkUsd)} (${parseFloat(balance).toFixed(1)} STRK)`
                : `${parseFloat(balance).toFixed(1)} STRK`}
            </span>
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red mt-3 text-center">{error}</p>}
    </div>
  );
}
