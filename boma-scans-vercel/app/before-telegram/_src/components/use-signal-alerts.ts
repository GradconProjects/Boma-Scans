"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { ScannerRow } from "@/app/before-telegram/_src/lib/market";
import { getMediumRiskShortlist } from "@/app/before-telegram/_src/lib/recommendations";
import { emptySignalLedger, parseSignalLedger, playSetupChime, reconcileSignals, SIGNAL_STORAGE_KEY, SOUND_STORAGE_KEY, signalScope, type SignalLedger } from "@/app/before-telegram/_src/lib/signal-alerts";

export function useSignalAlerts({rows, equity, live, scanAt, scope, now, onOpen}: {
  rows: ScannerRow[]; equity: number; live: boolean; scanAt: number | null;
  scope: string; now: number; onOpen: () => void;
}) {
  const [ledger, setLedger] = useState<SignalLedger>(emptySignalLedger);
  const ledgerRef = useRef<SignalLedger>(emptySignalLedger());
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const [soundError, setSoundError] = useState("");
  const [volume, setVolume] = useState(0.35);
  const contextRef = useRef<AudioContext | null>(null);
  const lastChime = useRef(0);
  const picks = useMemo(() => getMediumRiskShortlist(rows.filter(row => signalScope(row) === scope), equity, live, rows.length, now), [rows, equity, live, scope, now]);

  const saveLedger = useCallback((next: SignalLedger) => {
    ledgerRef.current = next;
    setLedger(next);
    try { localStorage.setItem(SIGNAL_STORAGE_KEY, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const next = parseSignalLedger(localStorage.getItem(SIGNAL_STORAGE_KEY));
        ledgerRef.current = next;
        setLedger(next);
        const preferences = JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) ?? "{}");
        setSoundEnabled(preferences.enabled === true);
        if (Number.isFinite(preferences.volume)) setVolume(Math.min(1, Math.max(0, preferences.volume)));
      } catch { setStorageError(true); }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try { localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify({enabled: soundEnabled, volume})); }
    catch { /* The current tab can still show and sound alerts. */ }
  }, [storageReady, soundEnabled, volume]);

  useEffect(() => () => {
    const context = contextRef.current;
    if (context) {context.onstatechange = null; void context.close().catch(() => {});}
  }, []);

  useEffect(() => {
    if (!storageReady || !live || !scanAt || now < scanAt) return;
    const timer = window.setTimeout(() => {
      const result = reconcileSignals(ledgerRef.current, picks, scope, scanAt, now);
      if (result.ledger === ledgerRef.current) return;
      saveLedger(result.ledger);
      if (!result.added.length) return;
      toast.success("🔔 " + result.added.length + " entry-ready setup" + (result.added.length === 1 ? "" : "s"), {
        description: result.added.slice(0, 3).map(item => (item.side === "LONG" ? "🟢 " : "🔴 ") + item.symbol + " · " + item.grade).join("  "),
        action: {label: "View notifications", onClick: onOpen}, duration: 9000,
      });
      if (soundEnabled && contextRef.current && now - lastChime.current >= 10_000) {
        try { if (playSetupChime(contextRef.current, volume)) lastChime.current = now; }
        catch { setSoundError("Sound could not play. Tap Enable sound or Test sound again."); setSoundReady(false); }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageReady, live, scanAt, picks, scope, now, soundEnabled, volume, saveLedger, onOpen]);

  async function enableSound() {
    try {
      const AudioConstructor = window.AudioContext ?? (window as Window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if (!AudioConstructor) throw new Error("This browser does not support alert audio.");
      let context = contextRef.current;
      if (!context || context.state === "closed") {
        context = new AudioConstructor();
        contextRef.current = context;
        context.onstatechange = () => setSoundReady(context?.state === "running");
      }
      await context.resume();
      if (context.state !== "running") throw new Error("Audio is paused by the browser. Try Enable sound again.");
      setSoundEnabled(true);
      setSoundReady(true);
      setSoundError("");
      playSetupChime(context, volume);
    } catch (error) {
      setSoundReady(false);
      setSoundError(error instanceof Error ? error.message : "Audio could not be activated.");
    }
  }

  function toggleSound() {
    if (soundEnabled && soundReady) {
      setSoundEnabled(false);
      setSoundReady(false);
      void contextRef.current?.suspend().catch(() => {});
    } else void enableSound();
  }

  function markRead(id?: string) {
    const readAt = Date.now();
    saveLedger({...ledgerRef.current, notifications: ledgerRef.current.notifications.map(item => (!id || item.id === id) && !item.readAt ? {...item, readAt} : item)});
  }

  return {picks, notifications: ledger.notifications, unread: ledger.notifications.filter(item => !item.readAt).length,
    soundEnabled, soundReady, soundError, volume, setVolume, toggleSound, testSound: enableSound,
    markRead, storageReady, storageError};
}
