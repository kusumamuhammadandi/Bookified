"use client";

// Create hooks/useVapi.ts: the core hook. Initializes Vapi SDK, manages call lifecycle (idle, connecting, starting, listening, thinking, speaking), tracks messages array + currentMessage streaming, handles duration timer with maxDuration enforcement, session tracking via server actions

import { useState, useEffect, useRef, useCallback } from "react";
import Vapi from "@vapi-ai/web";
import { useAuth } from "@clerk/nextjs";

import { useSubscription } from "@/hooks/useSubscription";
import { ASSISTANT_ID, DEFAULT_VOICE, voiceOptions } from "@/lib/constants";
import { IBook, Messages } from "@/types";
import {
  startVoiceSession,
  endVoiceSession,
} from "@/lib/actions/session.actions";

export function useLatestRef<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

const VAPI_API_KEY = process.env.NEXT_PUBLIC_VAPI_API_KEY;
const TIMER_INTERVAL_MS = 1000;
const SECONDS_PER_MINUTE = 60;

let vapi: InstanceType<typeof Vapi>;
function getVapi() {
  if (!vapi) {
    if (!VAPI_API_KEY) {
      throw new Error(
        "NEXT_PUBLIC_VAPI_API_KEY environment variable is not set",
      );
    }
    vapi = new Vapi(VAPI_API_KEY);
  }
  return vapi;
}

export type CallStatus =
  | "idle"
  | "connecting"
  | "starting"
  | "listening"
  | "thinking"
  | "speaking";

export function useVapi(book: IBook) {
  const { userId } = useAuth();
  const { limits } = useSubscription();

  const [status, setStatus] = useState<CallStatus>("idle");
  const [messages, setMessages] = useState<Messages[]>([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [currentUserMessage, setCurrentUserMessage] = useState("");
  const [duration, setDuration] = useState(0);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [isBillingError] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isStoppingRef = useRef(false);

  // Keep refs in sync with latest values for use in callbacks
  const maxDurationSeconds = limits?.maxDurationPerSession
    ? limits.maxDurationPerSession * 60
    : 15 * 60;
  const maxDurationRef = useLatestRef(maxDurationSeconds);
  const durationRef = useLatestRef(duration);

  // Resolve voice: book.persona is a key like "dave" | "rachel", map to ElevenLabs voice ID
  const voiceKey = (book.persona || DEFAULT_VOICE) as keyof typeof voiceOptions;
  const voiceId =
    voiceOptions[voiceKey]?.id ??
    voiceOptions[DEFAULT_VOICE as keyof typeof voiceOptions].id;

  // Set up Vapi event listeners
  useEffect(() => {
    // 🛡️ PENGAMAN 1: Jangan jalankan WebSocket ganda akibat kompiler agresif Turbopack
    if (!VAPI_API_KEY || VAPI_API_KEY.includes("dummy")) {
      console.warn(
        "Mode Asisten Dummy Aktif: Inisialisasi event listener Vapi dilewati.",
      );
      return;
    }

    let isMounted = true;
    let activeVapi: InstanceType<typeof Vapi> | null = null;

    const handlers = {
      "call-start": () => {
        if (!isMounted) return;
        isStoppingRef.current = false;
        setStatus("starting");
        setCurrentMessage("");
        setCurrentUserMessage("");

        startTimeRef.current = Date.now();
        setDuration(0);
        timerRef.current = setInterval(() => {
          if (startTimeRef.current && isMounted) {
            const newDuration = Math.floor(
              (Date.now() - startTimeRef.current) / TIMER_INTERVAL_MS,
            );
            setDuration(newDuration);

            if (newDuration >= maxDurationRef.current) {
              getVapi().stop();
              setLimitError(
                `Session time limit (${Math.floor(
                  maxDurationRef.current / SECONDS_PER_MINUTE,
                )} minutes) reached. Upgrade your plan for longer sessions.`,
              );
            }
          }
        }, TIMER_INTERVAL_MS);
      },

      "call-end": () => {
        if (!isMounted) return;
        setStatus("idle");
        setCurrentMessage("");
        setCurrentUserMessage("");

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        if (sessionIdRef.current) {
          endVoiceSession(sessionIdRef.current, durationRef.current).catch(
            (err) => console.error("Failed to end voice session:", err),
          );
          sessionIdRef.current = null;
        }

        startTimeRef.current = null;
      },

      "speech-start": () => {
        if (!isStoppingRef.current && isMounted) {
          setStatus("speaking");
        }
      },
      "speech-end": () => {
        if (!isStoppingRef.current && isMounted) {
          setStatus("listening");
        }
      },

      message: (message: {
        type: string;
        role: string;
        transcriptType: string;
        transcript: string;
      }) => {
        if (!isMounted || message.type !== "transcript") return;

        if (message.role === "user" && message.transcriptType === "final") {
          if (!isStoppingRef.current) {
            setStatus("thinking");
          }
          setCurrentUserMessage("");
        }

        if (message.role === "user" && message.transcriptType === "partial") {
          setCurrentUserMessage(message.transcript);
          return;
        }

        if (
          message.role === "assistant" &&
          message.transcriptType === "partial"
        ) {
          setCurrentMessage(message.transcript);
          return;
        }

        if (message.transcriptType === "final") {
          if (message.role === "assistant") setCurrentMessage("");
          if (message.role === "user") setCurrentUserMessage("");

          setMessages((prev) => {
            const isDupe = prev.some(
              (m) =>
                m.role === message.role && m.content === message.transcript,
            );
            return isDupe
              ? prev
              : [...prev, { role: message.role, content: message.transcript }];
          });
        }
      },

      error: (error: unknown) => {
        if (!isMounted) return;
        // Log with multiple strategies to capture any error shape
        console.error("Vapi error (raw):", error);
        console.error("Vapi error (string):", String(error));
        if (error && typeof error === "object") {
          console.error("Vapi error (keys):", Object.keys(error));
          console.error(
            "Vapi error (JSON):",
            JSON.stringify(error, Object.getOwnPropertyNames(error)),
          );
        }

        setStatus("idle");
        setCurrentMessage("");
        setCurrentUserMessage("");

        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }

        if (sessionIdRef.current) {
          endVoiceSession(sessionIdRef.current, durationRef.current).catch(
            (err) =>
              console.error("Failed to end voice session on error:", err),
          );
          sessionIdRef.current = null;
        }
      },
    };

    try {
      activeVapi = getVapi();
      Object.entries(handlers).forEach(([event, handler]) => {
        activeVapi?.on(event as any, handler);
      });
    } catch (e) {
      console.error(e);
    }

    return () => {
      isMounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (activeVapi) {
        Object.entries(handlers).forEach(([event, handler]) => {
          activeVapi?.off(event as any, handler);
        });
      }
    };
  }, [maxDurationRef, durationRef]);

  const start = useCallback(async () => {
    if (!VAPI_API_KEY || VAPI_API_KEY.includes("dummy")) {
      setLimitError(
        "Fitur suara asisten AI dinonaktifkan karena Anda menggunakan kunci API dummy.",
      );
      return;
    }

    try {
      const assistantIdToUse =
        process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID || ASSISTANT_ID;

      if (!assistantIdToUse || assistantIdToUse.includes("dummy")) {
        setLimitError(
          "Assistant ID tidak valid atau masih menggunakan data dummy.",
        );
        return;
      }

      // 🎤 Cek izin mikrofon sebelum start
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        setStatus("idle");
        setLimitError(
          "Izin mikrofon diperlukan. Mohon izinkan akses mikrofon di browser.",
        );
        return;
      }

      setStatus("connecting");
      setLimitError(null);

      // 🔍 Saring ID Buku agar yang terkirim adalah ObjectId valid (24 hex string)
      const currentBookId = book._id || (book as any).id;
      const validBookId =
        currentBookId && String(currentBookId).length >= 24
          ? String(currentBookId)
          : "000000000000000000000000";

      // ✅ PERBAIKAN: Urutan yang benar (userId, lalu bookId)
      const session = await startVoiceSession(userId!, validBookId);
      sessionIdRef.current =
        (session as any)?._id || (session as any)?.id || null;

      // ✅ FIX UTAMA: VOICE_SETTINGS (ElevenLabs config) tidak valid di level Vapi.start().
      // Property seperti stability, similarityBoost, dll harus dikonfigurasi di Vapi Dashboard,
      // bukan dikirim lewat SDK. Di sini kita hanya kirim voice provider config yang benar.
      await getVapi().start(assistantIdToUse, {
        variableValues: {
          bookTitle: book.title,
          bookContent: (book as any).description || (book as any).summary || "",
          userName: userId || "Reader",
        },
        // Voice override menggunakan format yang benar untuk Vapi SDK
        voice: {
          provider: "11labs",
          voiceId: voiceId,
          // ElevenLabs settings yang valid di Vapi SDK (bukan di root level)
          stability: 0.45,
          similarityBoost: 0.75,
          style: 0,
          useSpeakerBoost: true,
          speed: 1.0,
        },
      });
    } catch (err: any) {
      console.error("Failed to start Vapi call:", err);
      console.error("Error string:", String(err));
      if (err && typeof err === "object") {
        console.error(
          "Error JSON:",
          JSON.stringify(err, Object.getOwnPropertyNames(err)),
        );
      }
      setStatus("idle");
      setLimitError(err?.message || "Gagal memulai koneksi audio asisten.");
    }
  }, [book, voiceKey, voiceId, userId]);

  const stop = useCallback(() => {
    if (!VAPI_API_KEY || VAPI_API_KEY.includes("dummy")) return;
    isStoppingRef.current = true;
    getVapi().stop();
  }, []);

  const clearError = useCallback(() => {
    setLimitError(null);
  }, []);

  return {
    status,
    isActive: status !== "idle",
    messages,
    currentMessage,
    currentUserMessage,
    duration,
    start,
    stop,
    clearError,
    limitError,
    isBillingError,
    maxDurationSeconds,
  };
}
