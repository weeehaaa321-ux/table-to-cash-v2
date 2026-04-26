// ─────────────────────────────────────────────────────────────────
// Composition root — wires concrete adapters to use cases.
// API route handlers + presentation hooks import from here, never from
// individual adapters. Only file allowed to know both layers.
// ─────────────────────────────────────────────────────────────────

import { SystemClock } from "./time/SystemClock";
import { PrismaMenuRepository } from "./prisma/repositories/PrismaMenuRepository";
import { PrismaRestaurantRepository } from "./prisma/repositories/PrismaRestaurantRepository";
import { PrismaStaffAuthenticator } from "./auth/PrismaStaffAuthenticator";
import { PrismaStaffShiftRepository } from "./prisma/repositories/PrismaStaffShiftRepository";
import { PrismaMessageRepository } from "./prisma/repositories/PrismaMessageRepository";
import { PrismaRatingRepository } from "./prisma/repositories/PrismaRatingRepository";
import { WebPushNotifier } from "./push/WebPushNotifier";

import { BrowseMenuUseCase } from "@/application/menu/BrowseMenuUseCase";
import { AuthenticateStaffUseCase } from "@/application/staff/AuthenticateStaffUseCase";
import { ClockInOutUseCase } from "@/application/staff/ClockInOutUseCase";
import {
  GetCurrentRestaurantUseCase,
  UpdateRestaurantConfigUseCase,
} from "@/application/restaurant";
import { SendMessageUseCase, PollMessagesUseCase } from "@/application/messaging";
import { SubmitRatingUseCase } from "@/application/rating";

const clock = new SystemClock();
const menuRepo = new PrismaMenuRepository();
const restaurantRepo = new PrismaRestaurantRepository();
const staffAuth = new PrismaStaffAuthenticator();
const shiftRepo = new PrismaStaffShiftRepository();
const messageRepo = new PrismaMessageRepository();
const ratingRepo = new PrismaRatingRepository();
const pushNotifier = new WebPushNotifier();

export const useCases = {
  browseMenu: new BrowseMenuUseCase(menuRepo, clock),
  authenticateStaff: new AuthenticateStaffUseCase(staffAuth),
  clockInOut: new ClockInOutUseCase(shiftRepo, clock),
  getCurrentRestaurant: new GetCurrentRestaurantUseCase(restaurantRepo),
  updateRestaurantConfig: new UpdateRestaurantConfigUseCase(restaurantRepo),
  sendMessage: new SendMessageUseCase(messageRepo),
  pollMessages: new PollMessagesUseCase(messageRepo),
  submitRating: new SubmitRatingUseCase(ratingRepo),
};

export const ports = {
  clock,
  menuRepo,
  restaurantRepo,
  staffAuth,
  shiftRepo,
  messageRepo,
  ratingRepo,
  pushNotifier,
};
