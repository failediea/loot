"use client";

import { useState } from "react";
import { useAuth } from "@/providers/AuthProvider";

export function ConnectWallet() {
  const { user, address, username, connect, disconnect, loading } = useAuth();
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connect();
    } catch (e) {
      console.error("Connect failed:", e);
    } finally {
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <button disabled className="px-4 py-2 rounded-lg bg-bg3 text-text-dim text-sm cursor-not-allowed">
        Loading...
      </button>
    );
  }

  if (address) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg3/60 border border-border">
          <div className="w-1.5 h-1.5 rounded-full bg-green" />
          <span className="text-xs text-text">
            {username || `${address.slice(0, 6)}...${address.slice(-4)}`}
          </span>
        </div>
        {user?.isOwner && (
          <span className="text-[10px] px-2.5 py-1 rounded bg-amber/15 text-amber font-bold uppercase tracking-wider border border-amber/20">
            Owner
          </span>
        )}
        <button
          onClick={disconnect}
          className="px-3 py-1.5 text-xs rounded-lg bg-transparent text-text-dim hover:text-red hover:bg-red/10 transition-all duration-200 border border-transparent hover:border-red/20"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={connecting}
      className="px-5 py-2 rounded-lg bg-amber/15 text-amber font-semibold text-sm hover:bg-amber/25 transition-all duration-200 border border-amber/20 hover:border-amber/40 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
