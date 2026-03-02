"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";

interface SessionStatus {
  hasSession: boolean;
  expiresAt: number | null;
}

export function SessionSetup() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) fetchStatus();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const sessionData = params.get("startapp");
    if (sessionData) {
      handleSessionCallback(sessionData);
      const clean = window.location.pathname;
      window.history.replaceState({}, document.title, clean);
    }
  }, [user]);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/account/session");
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSession = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const initRes = await fetch("/api/account/session/init", { method: "POST" });
      if (!initRes.ok) throw new Error("Failed to initialize session");
      const { publicKey, keychainUrl } = await initRes.json();
      window.location.href = keychainUrl;
    } catch (e: any) {
      console.error("Session setup error:", e);
      setError(e.message);
      setSubmitting(false);
    }
  };

  const handleSessionCallback = async (encodedSession: string) => {
    setSubmitting(true);
    setError(null);

    try {
      const padded = encodedSession + "=".repeat((4 - encodedSession.length % 4) % 4);
      const sessionJson = atob(padded);
      const session = JSON.parse(sessionJson);

      const res = await fetch("/api/account/session/finalize", {
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

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to finalize session");
      }

      await fetchStatus();
    } catch (e: any) {
      console.error("Session callback error:", e);
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;
  if (loading) {
    return <span className="text-xs text-text-dim">Checking session...</span>;
  }

  if (status?.hasSession) {
    const expiryDate = status.expiresAt
      ? new Date(status.expiresAt * 1000).toLocaleDateString()
      : "Unknown";
    const isExpired = status.expiresAt ? status.expiresAt < Date.now() / 1000 : false;

    if (isExpired) {
      return (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red/5 border border-red/15">
            <div className="w-1.5 h-1.5 rounded-full bg-red" />
            <span className="text-xs text-red/80">Session expired</span>
          </div>
          <button
            onClick={handleSetupSession}
            disabled={submitting}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber/10 text-amber hover:bg-amber/20 transition-colors border border-amber/20 disabled:opacity-50"
          >
            {submitting ? "Setting up..." : "Renew"}
          </button>
          {error && <span className="text-xs text-red">{error}</span>}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green/5 border border-green/15">
        <div className="w-1.5 h-1.5 rounded-full bg-green" />
        <span className="text-xs text-text-dim">Session active &middot; expires {expiryDate}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow/5 border border-yellow/15">
        <div className="w-1.5 h-1.5 rounded-full bg-yellow" />
        <span className="text-xs text-yellow/80">Session required</span>
      </div>
      <button
        onClick={handleSetupSession}
        disabled={submitting}
        className="px-3 py-1.5 text-xs rounded-lg bg-amber/10 text-amber font-semibold hover:bg-amber/20 transition-colors border border-amber/20 disabled:opacity-50"
      >
        {submitting ? "Setting up..." : "Set Up Session"}
      </button>
      {error && <span className="text-xs text-red">{error}</span>}
    </div>
  );
}
