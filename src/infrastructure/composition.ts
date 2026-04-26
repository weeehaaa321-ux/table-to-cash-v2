// ─────────────────────────────────────────────────────────────────
// Composition root — wires concrete adapters to use cases.
//
// API route handlers and presentation hooks import from here, never
// from individual adapters. This is the only file allowed to know
// about both `application/` and `infrastructure/` simultaneously.
//
// Singletons are eagerly constructed at module import. They're cheap
// (no I/O) — just object construction.
// ─────────────────────────────────────────────────────────────────

import { SystemClock } from "./time/SystemClock";
import { PrismaMenuRepository } from "./prisma/repositories/PrismaMenuRepository";
import { PrismaStaffAuthenticator } from "./auth/PrismaStaffAuthenticator";
import { WebPushNotifier } from "./push/WebPushNotifier";

import { BrowseMenuUseCase } from "@/application/menu/BrowseMenuUseCase";
import { AuthenticateStaffUseCase } from "@/application/staff/AuthenticateStaffUseCase";

// ─── Singletons ────────────────────────────────────────────────

const clock = new SystemClock();
const menuRepo = new PrismaMenuRepository();
const staffAuth = new PrismaStaffAuthenticator();
const pushNotifier = new WebPushNotifier();

// ─── Use cases ─────────────────────────────────────────────────

export const useCases = {
  browseMenu: new BrowseMenuUseCase(menuRepo, clock),
  authenticateStaff: new AuthenticateStaffUseCase(staffAuth),
};

// Expose ports too, for routes that need to call repositories directly
// (e.g. health check, analytics queries that don't fit a use case yet).
export const ports = {
  clock,
  menuRepo,
  staffAuth,
  pushNotifier,
};
