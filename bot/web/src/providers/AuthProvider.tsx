"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import ControllerProvider from "@cartridge/controller";

interface User {
  id: number;
  address: string;
  isOwner: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  token: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  address: string | null;
  username: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  token: null,
  connect: async () => {},
  disconnect: () => {},
  address: null,
  username: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const controllerRef = useRef<ControllerProvider | null>(null);

  // Initialize controller
  useEffect(() => {
    if (typeof window === "undefined") return;

    const controller = new ControllerProvider({
      defaultChainId: "0x534e5f4d41494e",
      chains: [
        {
          rpcUrl: "https://api.cartridge.gg/x/starknet/mainnet",
        },
      ],
    });
    controllerRef.current = controller;

    // Check if already connected (auto-reconnect)
    controller.probe().then(async (account) => {
      if (account) {
        setAddress(account.address);
        try {
          const name = await controller.username();
          if (name) setUsername(name);
        } catch {}
        await verifyWithBackend(account.address);
      } else {
        // Probe returned null — try cookie-based session restore
        await restoreFromCookie();
      }
      setLoading(false);
    }).catch(async () => {
      // Probe failed — try cookie-based session restore
      await restoreFromCookie();
      setLoading(false);
    });
  }, []);

  const verifyWithBackend = async (addr: string) => {
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setToken(data.token || null);
      }
    } catch (e) {
      console.error("Auth verification failed:", e);
    }
  };

  const restoreFromCookie = async () => {
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: "__cookie__" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
          setAddress(data.user.address || null);
          setToken(data.token || null);
        }
      }
    } catch {}
  };

  const connect = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return;

    try {
      const account = await controller.connect();
      if (account) {
        setAddress(account.address);
        try {
          const name = await controller.username();
          if (name) setUsername(name);
        } catch {}
        await verifyWithBackend(account.address);
      }
    } catch (e) {
      console.error("Controller connect failed:", e);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const controller = controllerRef.current;
    if (controller) {
      try { await controller.disconnect(); } catch {}
    }
    setUser(null);
    setToken(null);
    setAddress(null);
    setUsername(null);
    document.cookie = "ls-auth=; path=/; max-age=0";
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, token, connect, disconnect, address, username }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
