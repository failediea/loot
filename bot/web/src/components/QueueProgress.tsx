"use client";

import { useState } from "react";

interface Queue {
  id: number;
  totalGames: number;
  completedGames: number;
  currentGameRequestId: number | null;
  status: string;
}

interface Props {
  queue: Queue;
}

export function QueueProgress({ queue }: Props) {
  const [cancelling, setCancelling] = useState(false);

  // Only render for multi-game queues
  if (queue.totalGames <= 1) return null;

  const current = (queue.completedGames || 0) + 1;
  const pct = ((queue.completedGames || 0) / queue.totalGames) * 100;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await fetch("/api/games/queue/cancel", { method: "POST" });
    } catch {
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-5 py-2 bg-amber/[0.04] border-b border-amber/15">
      <span className="text-xs text-amber font-semibold">
        Game {current} of {queue.totalGames}
      </span>

      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-bg3/60 rounded-full overflow-hidden max-w-xs">
        <div
          className="h-full rounded-full bg-amber transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <span className="text-[10px] text-text-dim">
        {queue.completedGames || 0}/{queue.totalGames} done
      </span>

      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="text-[10px] px-2.5 py-1 rounded border border-red/20 text-red/70 hover:bg-red/10 hover:text-red transition-all disabled:opacity-50"
      >
        {cancelling ? "Cancelling..." : "Cancel Queue"}
      </button>
    </div>
  );
}
