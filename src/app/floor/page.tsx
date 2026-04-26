"use client";

import { useEffect, useState } from "react";
import { FloorLoginScreen } from "@/components/floor/FloorLoginScreen";
import { FloorManagerView } from "@/components/floor/FloorManagerView";
import { SESSION_DURATION } from "@/components/floor/constants";
import type { LoggedInStaff } from "@/components/floor/types";

export default function FloorManagerPage() {
  const [staff, setStaff] = useState<LoggedInStaff | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("floormanager_staff");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.loginAt && Date.now() - parsed.loginAt < SESSION_DURATION) {
          setStaff(parsed);
        } else {
          localStorage.removeItem("floormanager_staff");
        }
      }
    } catch {}
  }, []);

  const handleLogin = (s: LoggedInStaff) => {
    setStaff(s);
    try { localStorage.setItem("floormanager_staff", JSON.stringify(s)); } catch {}
  };

  if (!staff) return <FloorLoginScreen onLogin={handleLogin} />;
  return <FloorManagerView staff={staff} />;
}
