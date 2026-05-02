"use client";

import { Suspense, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useCart } from "@/store/cart";
import { PhoneFrame } from "@/presentation/components/ui/PhoneFrame";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";

export default function ScanPageWrapper() {
  return (
    <Suspense>
      <ScanPage />
    </Suspense>
  );
}

function ScanPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tableNumber = searchParams.get("table") ?? searchParams.get("t") ?? "1";
  const restaurantName = searchParams.get("name") ?? "Neom Dahab";
  const restaurantSlug = searchParams.get("slug") ?? process.env.NEXT_PUBLIC_RESTAURANT_SLUG ?? "neom-dahab";

  const setTable = useCart((s) => s.setTable);
  const setSessionId = useCart((s) => s.setSessionId);
  const setIsSessionOwner = useCart((s) => s.setIsSessionOwner);
  const setGuestNumber = useCart((s) => s.setGuestNumber);
  const setGuestName = useCart((s) => s.setGuestName);
  const setHasPaymentAuthority = useCart((s) => s.setHasPaymentAuthority);

  const { lang, toggleLang, t, dir } = useLanguage();
  const [status, setStatus] = useState<"checking" | "entering" | "branding" | "blocked" | "waiting_approval" | "rejected" | "name_prompt">("checking");
  const [nameInput, setNameInput] = useState("");
  const [existingSession, setExistingSession] = useState(false);
  const [blockedTable, setBlockedTable] = useState<string | null>(null);
  const [joinRequestId, setJoinRequestId] = useState<string | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<string>("");
  const [sessionCreateError, setSessionCreateError] = useState(false);
  const [approvalTimedOut, setApprovalTimedOut] = useState(false);

  // Check for existing open session on this table
  useEffect(() => {
    async function checkSession() {
      try {
        // Check if this guest already has an active session on a DIFFERENT table
        const existingSessionId = localStorage.getItem("ttc_sessionId");
        const existingTable = localStorage.getItem("ttc_tableNumber");
        if (existingSessionId && existingTable && existingTable !== tableNumber) {
          // Verify the existing session is still open
          try {
            const checkRes = await fetch(
              `/api/sessions?tableNumber=${existingTable}&restaurantId=${restaurantSlug}`
            );
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              if (checkData.session && checkData.session.id === existingSessionId) {
                // They have an active session on another table — block
                setBlockedTable(existingTable);
                setStatus("blocked");
                return;
              }
            }
          } catch { /* session may have expired, continue */ }
          // Session no longer exists — clear stale data
          localStorage.removeItem("ttc_sessionId");
          localStorage.removeItem("ttc_tableNumber");
        }

        const res = await fetch(
          `/api/sessions?tableNumber=${tableNumber}&restaurantId=${restaurantSlug}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setExistingSession(true);

            // Check if this browser is the session owner OR an already-approved
            // joiner. Without the member check, a guest 2+ who presses back
            // after being approved would re-trigger a join request and have
            // to be re-approved by the owner — very bad UX.
            let wasOwner = false;
            let wasMember = false;
            try {
              wasOwner = sessionStorage.getItem(`ttc_owner_${data.session.id}`) === "1";
              wasMember = sessionStorage.getItem(`ttc_member_${data.session.id}`) === "1";
            } catch {}

            if (wasOwner) {
              // Owner returning — go straight in
              setTable(tableNumber, restaurantSlug);
              setSessionId(data.session.id);
              setIsSessionOwner(true);
              setGuestNumber(1);
              setHasPaymentAuthority(true);
              localStorage.setItem("ttc_tableNumber", tableNumber);
              setMenuTarget(`/menu?table=${tableNumber}&restaurant=${restaurantSlug}&session=${data.session.id}`);
              gateOnName(data.session.id);
              return;
            }

            if (wasMember) {
              // Previously-approved joiner returning — restore their state
              // without hitting the join-request flow again.
              const savedGuestNumber = parseInt(
                sessionStorage.getItem("ttc_guestNumber") || "0",
                10
              );
              setTable(tableNumber, restaurantSlug);
              setSessionId(data.session.id);
              setIsSessionOwner(false);
              setGuestNumber(savedGuestNumber > 1 ? savedGuestNumber : (data.session.guestCount || 2));
              setHasPaymentAuthority(false);
              localStorage.setItem("ttc_tableNumber", tableNumber);
              setMenuTarget(`/menu?table=${tableNumber}&restaurant=${restaurantSlug}&session=${data.session.id}`);
              gateOnName(data.session.id);
              return;
            }

            // New guest joining — send join request for owner approval
            const guestId = localStorage.getItem("ttc_guestId") || `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            localStorage.setItem("ttc_guestId", guestId);

            try {
              const joinRes = await fetch("/api/sessions/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId: data.session.id, guestId }),
              });
              if (joinRes.ok) {
                const joinData = await joinRes.json();
                setJoinRequestId(joinData.id);
                setPendingSessionId(data.session.id);
                setStatus("waiting_approval");
                return;
              }
            } catch { /* fall through */ }

            // Fallback: if join request API fails, just enter
            setTable(tableNumber, restaurantSlug);
            setSessionId(data.session.id);
            setIsSessionOwner(false);
            setGuestNumber(data.session.guestCount || 2);
            setHasPaymentAuthority(false);
            try { sessionStorage.setItem(`ttc_member_${data.session.id}`, "1"); } catch {}
            localStorage.setItem("ttc_tableNumber", tableNumber);
            setMenuTarget(`/menu?table=${tableNumber}&restaurant=${restaurantSlug}&session=${data.session.id}`);
            gateOnName(data.session.id);
            return;
          }
        }
      } catch {
        // Network error — fall through to normal flow
      }
      // No existing session — auto-create, no button needed
      autoStart();
    }

    function gateOnName(sessionId: string) {
      // If the guest already typed their name on a previous visit
      // to this same session, skip the prompt and go straight to
      // the entering animation. Otherwise show the name input.
      // Optional — they can submit empty / "Skip" and the rest of
      // the system falls back to "Guest #N".
      let stored: string | null = null;
      try { stored = localStorage.getItem(`ttc_guestName_${sessionId}`); } catch {}
      if (stored) {
        setGuestName(stored);
        setStatus("entering");
        setTimeout(() => setStatus("branding"), 800);
      } else {
        setStatus("name_prompt");
      }
    }

    async function autoStart() {
      setTable(tableNumber, restaurantSlug);
      setSessionCreateError(false);
      try {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableNumber, restaurantId: restaurantSlug }),
        });
        if (res.ok) {
          const session = await res.json();
          setSessionId(session.id);
          setIsSessionOwner(true);
          setGuestNumber(1);
          setHasPaymentAuthority(true);
          try { sessionStorage.setItem(`ttc_owner_${session.id}`, "1"); } catch {}
          localStorage.setItem("ttc_tableNumber", tableNumber);
          setMenuTarget(`/menu?table=${tableNumber}&restaurant=${restaurantSlug}&session=${session.id}`);
          gateOnName(session.id);
          return;
        }
        // Non-ok response — show error
        setSessionCreateError(true);
      } catch {
        setSessionCreateError(true);
      }
    }

    checkSession();
  }, [tableNumber, restaurantSlug, router, setTable, setSessionId, setIsSessionOwner, setGuestNumber, setGuestName, setHasPaymentAuthority]);

  // Poll for join request approval
  useEffect(() => {
    if (status !== "waiting_approval" || !joinRequestId || !pendingSessionId) return;

    setApprovalTimedOut(false);

    // 60-second timeout — if approval hasn't come, show a retry prompt
    const timeout = setTimeout(() => {
      setApprovalTimedOut(true);
    }, 60_000);

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/join?requestId=${joinRequestId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === "approved") {
          clearInterval(interval);
          clearTimeout(timeout);
          setTable(tableNumber, restaurantSlug);
          setSessionId(pendingSessionId);
          setIsSessionOwner(false);
          // Mark this browser as an approved member so a back-button return
          // to /scan recognizes them and skips the join-request flow.
          try { sessionStorage.setItem(`ttc_member_${pendingSessionId}`, "1"); } catch {}
          // Fetch current guest count to assign guest number
          try {
            const sessRes = await fetch(`/api/sessions?tableNumber=${tableNumber}&restaurantId=${restaurantSlug}`);
            if (sessRes.ok) {
              const sessData = await sessRes.json();
              setGuestNumber(sessData.session?.guestCount || 2);
            } else {
              setGuestNumber(2);
            }
          } catch { setGuestNumber(2); }
          setHasPaymentAuthority(false);
          localStorage.setItem("ttc_tableNumber", tableNumber);
          setMenuTarget(`/menu?table=${tableNumber}&restaurant=${restaurantSlug}&session=${pendingSessionId}`);
          // Same name-gate as the other entry paths.
          let stored: string | null = null;
          try { stored = localStorage.getItem(`ttc_guestName_${pendingSessionId}`); } catch {}
          if (stored) {
            setGuestName(stored);
            setStatus("entering");
            setTimeout(() => setStatus("branding"), 800);
          } else {
            setStatus("name_prompt");
          }
        } else if (data.status === "rejected") {
          clearInterval(interval);
          clearTimeout(timeout);
          setStatus("rejected");
        }
      } catch { /* retry next tick */ }
    }, 2000);

    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [status, joinRequestId, pendingSessionId, tableNumber, restaurantSlug, router, setTable, setSessionId, setIsSessionOwner]);

  return (
    <PhoneFrame dark>
      <div className="h-full relative overflow-hidden" dir={dir}>
        {/* Dark cinematic background */}
        <div className="absolute inset-0 bg-gradient-to-b from-sand-950 via-sand-900 to-sand-950" />

        {/* Ambient glow effects */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.4) 0%, transparent 70%)" }} />
        <div className="absolute bottom-0 left-0 right-0 h-60 opacity-30"
          style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(245,158,11,0.3) 0%, transparent 70%)" }} />

        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        {/* Language toggle */}
        <div className="absolute top-4 right-4 z-30 safe-top">
          <LanguageToggle lang={lang} onToggle={toggleLang} className="bg-white/10 border-2 border-white/10 text-white" />
        </div>

        {/* Content */}
        <div className="relative min-h-full h-dvh flex flex-col px-6 safe-top">
          <AnimatePresence mode="wait">
            {/* Loading — checking for existing session */}
            {status === "checking" && !sessionCreateError && (
              <motion.div
                key="loading"
                className="flex-1 flex flex-col items-center justify-center text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="w-3 h-3 rounded-full bg-white/60"
                  animate={{ scale: [1, 1.5, 1], opacity: [0.4, 1, 0.4] }}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
                <p className="text-white/40 text-sm mt-4 font-light tracking-wide">{t("scan.checking")}</p>
              </motion.div>
            )}

            {/* Session creation failed */}
            {sessionCreateError && (
              <motion.div
                key="session-error"
                className="flex-1 flex flex-col items-center justify-center text-center px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="w-16 h-16 rounded-full bg-status-warn-500/20 border-2 border-status-warn-500/40 flex items-center justify-center mb-6">
                  <span className="text-3xl">⚠</span>
                </div>
                <h2 className="text-2xl font-extrabold text-white mb-3 tracking-tight">
                  {lang === "ar" ? "تعذر الاتصال بالمطعم" : "Couldn't connect to restaurant"}
                </h2>
                <p className="text-white/50 text-sm leading-relaxed mb-6">
                  {lang === "ar" ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى" : "Check your connection and try again"}
                </p>
                <button
                  onClick={() => {
                    setSessionCreateError(false);
                    setStatus("checking");
                    // Re-run the check from scratch
                    window.location.reload();
                  }}
                  className="px-8 py-3.5 rounded-2xl bg-status-warn-500 text-white font-extrabold text-sm uppercase tracking-wider shadow-lg shadow-status-warn-500/20 active:scale-95 transition"
                >
                  {lang === "ar" ? "حاول مرة أخرى" : "Try Again"}
                </button>
              </motion.div>
            )}

            {status === "waiting_approval" && (
              <motion.div
                key="waiting"
                className="flex-1 flex flex-col items-center justify-center text-center px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="w-16 h-16 rounded-full border-2 border-ocean-400/40 flex items-center justify-center mb-6"
                  animate={{ borderColor: ["rgba(129,140,248,0.2)", "rgba(129,140,248,0.6)", "rgba(129,140,248,0.2)"] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <motion.div
                    className="w-4 h-4 rounded-full bg-ocean-400"
                    animate={{ scale: [0.8, 1.3, 0.8] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                </motion.div>
                <h2 className="text-lg font-bold text-white mb-2">Ask Guest #1 to Let You In</h2>
                <p className="text-white/40 text-sm leading-relaxed">
                  Guest #1 at your table needs to approve your request.<br />Ask them to tap the notification on their phone.
                </p>
                {approvalTimedOut && (
                  <motion.div
                    className="mt-6 bg-status-warn-500/15 border border-status-warn-500/30 rounded-xl p-4"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <p className="text-status-warn-300 text-sm font-semibold mb-3">
                      {lang === "ar" ? "استغرق الأمر وقتاً طويلاً؟ حاول مسح رمز QR مرة أخرى" : "Taking too long? Try scanning the QR code again"}
                    </p>
                    <button
                      onClick={() => {
                        setApprovalTimedOut(false);
                        setJoinRequestId(null);
                        setPendingSessionId(null);
                        setStatus("checking");
                        window.location.reload();
                      }}
                      className="px-6 py-2.5 rounded-xl bg-status-warn-500 text-white font-bold text-sm active:scale-95 transition"
                    >
                      {lang === "ar" ? "إعادة المحاولة" : "Retry"}
                    </button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {status === "rejected" && (
              <motion.div
                key="rejected"
                className="flex-1 flex flex-col items-center justify-center text-center px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="w-16 h-16 rounded-full bg-status-bad-500/20 border-2 border-status-bad-500/40 flex items-center justify-center mb-6">
                  <span className="text-3xl">✕</span>
                </div>
                <h2 className="text-xl font-bold text-white mb-3">Request Declined</h2>
                <p className="text-white/50 text-sm leading-relaxed">
                  Guest #1 did not approve your request to join this table.
                </p>
              </motion.div>
            )}

            {status === "blocked" && (
              <motion.div
                key="blocked"
                className="flex-1 flex flex-col items-center justify-center text-center px-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="w-16 h-16 rounded-full bg-status-bad-500/20 border-2 border-status-bad-500/40 flex items-center justify-center mb-6">
                  <span className="text-3xl">✋</span>
                </div>
                <h2 className="text-2xl font-extrabold text-white mb-3 tracking-tight">Active Session Exists</h2>
                <p className="text-white/50 text-sm leading-relaxed mb-6">
                  You already have an active session on <span className="text-white font-extrabold">Table {blockedTable}</span>.
                  Please close that session first before joining a new table.
                </p>
                <button
                  onClick={() => {
                    const sid = localStorage.getItem("ttc_sessionId");
                    router.push(`/track?session=${sid}&table=${blockedTable}&restaurant=${restaurantSlug}`);
                  }}
                  className="px-8 py-3.5 rounded-2xl bg-white/10 border-2 border-white/20 text-white font-extrabold text-sm uppercase tracking-wider active:scale-95 transition"
                >
                  Go to Table {blockedTable}
                </button>
              </motion.div>
            )}

            {status === "name_prompt" && (
              <motion.div
                key="name_prompt"
                className="flex-1 flex flex-col items-center justify-center text-center px-6"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="w-14 h-14 rounded-full bg-white/10 border-2 border-white/15 flex items-center justify-center mb-5">
                  <span className="text-2xl">👋</span>
                </div>
                <h2 className="text-xl font-extrabold text-white mb-2 tracking-tight">
                  {lang === "ar" ? "ما اسمك؟" : "What's your name?"}
                </h2>
                <p className="text-white/50 text-xs leading-relaxed mb-6 max-w-xs">
                  {lang === "ar"
                    ? "سيظهر اسمك على الفاتورة وعلى شاشة النادل عند الطلب."
                    : "Shown on your receipt and the waiter's screen when you order."}
                </p>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value.slice(0, 30))}
                  placeholder={lang === "ar" ? "اسمك" : "Your name"}
                  autoFocus
                  className="w-full max-w-xs mb-3 px-4 py-3 rounded-xl bg-white/10 border-2 border-white/15 text-white text-center font-bold placeholder-white/30 focus:outline-none focus:border-ocean-400"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nameInput.trim().length > 0) {
                      const sid = useCart.getState().sessionId;
                      setGuestName(nameInput);
                      if (sid && nameInput.trim()) {
                        try { localStorage.setItem(`ttc_guestName_${sid}`, nameInput.trim().slice(0, 30)); } catch {}
                      }
                      setStatus("entering");
                      setTimeout(() => setStatus("branding"), 800);
                    }
                  }}
                />
                <div className="flex gap-2 w-full max-w-xs">
                  <button
                    onClick={() => {
                      setStatus("entering");
                      setTimeout(() => setStatus("branding"), 800);
                    }}
                    className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm font-bold active:scale-95 transition"
                  >
                    {lang === "ar" ? "تخطّي" : "Skip"}
                  </button>
                  <button
                    onClick={() => {
                      if (nameInput.trim().length === 0) return;
                      const sid = useCart.getState().sessionId;
                      setGuestName(nameInput);
                      if (sid) {
                        try { localStorage.setItem(`ttc_guestName_${sid}`, nameInput.trim().slice(0, 30)); } catch {}
                      }
                      setStatus("entering");
                      setTimeout(() => setStatus("branding"), 800);
                    }}
                    disabled={nameInput.trim().length === 0}
                    className={`flex-1 py-3 rounded-xl font-extrabold text-sm uppercase tracking-wider active:scale-95 transition ${
                      nameInput.trim().length === 0
                        ? "bg-white/10 text-white/30 cursor-not-allowed"
                        : "bg-ocean-500 text-white shadow-lg shadow-ocean-500/30"
                    }`}
                  >
                    {lang === "ar" ? "تابع" : "Continue"}
                  </button>
                </div>
              </motion.div>
            )}

            {status === "branding" && (
              <motion.div
                key="branding"
                className="flex-1 flex flex-col items-center justify-center text-center px-6 relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.6 }}
                onAnimationComplete={() => {
                  setTimeout(() => router.push(menuTarget), 2400);
                }}
              >
                {/* Table chip */}
                <motion.div
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 mb-10 backdrop-blur-sm"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.5 }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-status-good-400 animate-pulse" />
                  <span className="text-white/70 text-[10px] font-semibold tracking-[0.2em] uppercase">
                    {lang === "ar" ? `طاولة ${tableNumber}` : `Table ${tableNumber}`}
                  </span>
                </motion.div>

                {/* Logo with concentric rings */}
                <div className="relative mb-8">
                  <motion.div
                    className="absolute inset-0 rounded-full border border-white/10"
                    style={{ width: 180, height: 180, left: -26, top: -26 }}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: [0.6, 1.1, 1], opacity: [0, 0.6, 0.3] }}
                    transition={{ duration: 2, delay: 0.2, ease: "easeOut" }}
                  />
                  <motion.div
                    className="absolute inset-0 rounded-full border border-white/5"
                    style={{ width: 230, height: 230, left: -51, top: -51 }}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: [0.6, 1.1, 1], opacity: [0, 0.4, 0.15] }}
                    transition={{ duration: 2.4, delay: 0.3, ease: "easeOut" }}
                  />
                  <motion.div
                    className="w-32 h-32 rounded-[28px] bg-white flex items-center justify-center shadow-[0_25px_60px_-15px_rgba(99,102,241,0.5)] overflow-hidden relative"
                    initial={{ scale: 0, rotate: -8 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", damping: 14, stiffness: 120, delay: 0.15 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/restaurant-logo.jpg"
                      alt={restaurantName}
                      className="w-full h-full object-contain"
                      style={{ mixBlendMode: "multiply" }}
                    />
                  </motion.div>
                </div>

                <motion.p
                  className="text-white/30 text-[10px] font-semibold tracking-[0.25em] uppercase mb-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.55 }}
                >
                  {lang === "ar" ? "مرحباً بك في" : "Welcome to"}
                </motion.p>

                <motion.h1
                  className="text-[28px] font-semibold text-white tracking-tight mb-3 leading-none"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.65, duration: 0.5 }}
                >
                  {restaurantName}
                </motion.h1>

                <motion.div
                  className="flex items-center gap-2 mb-10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.85 }}
                >
                  <div className="h-px w-8 bg-white/20" />
                  <span className="text-white/40 text-[11px] font-light tracking-widest">
                    {existingSession
                      ? (lang === "ar" ? "جاري الانضمام" : "JOINING TABLE")
                      : (lang === "ar" ? "جاري التحضير" : "PREPARING MENU")}
                  </span>
                  <div className="h-px w-8 bg-white/20" />
                </motion.div>

                {/* Loading dots */}
                <motion.div
                  className="flex gap-1.5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.0 }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-white/50"
                      animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.15, 0.8] }}
                      transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
                    />
                  ))}
                </motion.div>
              </motion.div>
            )}

            {status === "entering" && (
              <motion.div
                key="entering"
                className="flex-1 flex flex-col items-center justify-center text-center"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <motion.div
                  className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center mb-6"
                  animate={{ borderColor: ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.3)", "rgba(255,255,255,0.1)"] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <motion.div
                    className="w-4 h-4 rounded-full bg-white"
                    animate={{ scale: [0.8, 1.2, 0.8] }}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  />
                </motion.div>
                <p className="text-lg font-semibold text-white tracking-tight">
                  {existingSession ? t("scan.joining") : t("scan.preparing")}
                </p>
                {existingSession && (
                  <p className="text-sm text-white/40 mt-2 font-light">
                    {t("scan.activeSession")}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PhoneFrame>
  );
}
