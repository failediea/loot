"use client";

import { useState, useEffect } from "react";

interface Props {
  onConnect: () => void;
}

export function LandingHero({ onConnect }: Props) {
  const [gamePriceUsd, setGamePriceUsd] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/price/strk")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.ticketUsd) {
          const usd = data.ticketUsd;
          setGamePriceUsd(usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Atmospheric background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-bg via-bg to-bg" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-amber/[0.03] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] bg-red/[0.02] rounded-full blur-[100px]" />
        <div className="absolute top-1/3 right-1/4 w-[300px] h-[300px] bg-purple/[0.02] rounded-full blur-[80px]" />
      </div>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 py-20 text-center">
        <div className="animate-fade-in">
          <p className="text-amber/80 text-xs uppercase tracking-[0.4em] mb-6 font-semibold">
            Automated Dungeon Crawler
          </p>

          <h1 className="font-display text-5xl md:text-7xl font-bold text-text-bright mb-6 leading-tight text-glow-amber">
            Death Mountain
          </h1>

          <p className="text-text max-w-lg mx-auto mb-3 text-sm leading-relaxed">
            Deploy our battle-hardened bot to play
            <span className="text-amber font-semibold"> Loot Survivor </span>
            on your behalf.
          </p>
          <p className="text-text-dim max-w-lg mx-auto mb-14 text-sm leading-relaxed">
            Watch your adventurer battle beasts, collect loot, and
            chase high scores &mdash; fully automated on StarkNet.
          </p>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl w-full mb-14 animate-fade-in" style={{ animationDelay: "0.15s" }}>
          <FeatureCard
            icon="&#9876;"
            title="Connect & Play"
            description="Link your Cartridge wallet, delegate a session key, and start playing in under a minute."
          />
          <FeatureCard
            icon="&#9670;"
            title="Live Dashboard"
            description="Real-time HP, equipment, combat decisions, and transaction monitoring via WebSocket."
          />
          <FeatureCard
            icon="&#9881;"
            title="Smart Strategy"
            description="Monte Carlo combat simulation, optimal stat allocation, and dynamic gear swapping."
          />
        </div>

        {/* How it works */}
        <div className="max-w-2xl w-full mb-14 animate-fade-in" style={{ animationDelay: "0.25s" }}>
          <div className="flex items-center gap-3 justify-center mb-6">
            <div className="w-16 h-px bg-gradient-to-r from-transparent to-border" />
            <span className="font-display text-[11px] uppercase tracking-[0.2em] text-text-dim font-semibold">
              How it works
            </span>
            <div className="w-16 h-px bg-gradient-to-l from-transparent to-border" />
          </div>
          <div className="grid grid-cols-3 gap-6 text-center">
            <StepItem step="1" label="Connect" description="Cartridge wallet" />
            <StepItem step="2" label="Fund" description={gamePriceUsd ? `${gamePriceUsd} per game` : "~18 STRK per game"} />
            <StepItem step="3" label="Watch" description="Live dashboard" />
          </div>
        </div>

        {/* CTA */}
        <div className="animate-fade-in" style={{ animationDelay: "0.35s" }}>
          <button
            onClick={onConnect}
            className="group relative inline-flex items-center gap-3 px-10 py-4 rounded-lg bg-amber/15 text-amber font-display font-bold text-xl tracking-wide hover:bg-amber/25 transition-all duration-300 border border-amber/30 hover:border-amber/50 glow-amber"
          >
            Enter the Mountain
            <span className="text-amber/60 group-hover:translate-x-1 transition-transform duration-200">&rarr;</span>
          </button>
          <p className="text-text-dim/50 text-[10px] mt-3 tracking-wider">
            Powered by StarkNet &middot; No private keys shared
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 px-8 py-5 text-center border-t border-border/50">
        <p className="text-text-dim text-xs tracking-wider">
          Death Mountain &mdash; Loot Survivor on StarkNet
        </p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="card card-hover p-6 text-left">
      <div className="text-2xl mb-3 text-amber/70">{icon}</div>
      <h3 className="font-display text-text-bright font-semibold mb-2 text-sm tracking-wide">{title}</h3>
      <p className="text-text-dim text-xs leading-relaxed">{description}</p>
    </div>
  );
}

function StepItem({ step, label, description }: { step: string; label: string; description: string }) {
  return (
    <div>
      <div className="w-8 h-8 rounded-full border border-amber/30 bg-amber/10 flex items-center justify-center text-amber text-xs font-bold mx-auto mb-2">
        {step}
      </div>
      <div className="text-text-bright text-xs font-semibold">{label}</div>
      <div className="text-text-dim text-[10px] mt-0.5">{description}</div>
    </div>
  );
}
