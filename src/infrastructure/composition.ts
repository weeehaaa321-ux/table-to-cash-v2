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
import { MenuReadUseCase } from "@/application/menu/MenuReadUseCase";
import { AuthenticateStaffUseCase } from "@/application/staff/AuthenticateStaffUseCase";
import { ClockInOutUseCase } from "@/application/staff/ClockInOutUseCase";
import { StaffManagementUseCase } from "@/application/staff/StaffManagementUseCase";
import {
  GetCurrentRestaurantUseCase,
  UpdateRestaurantConfigUseCase,
  TableManagementUseCase,
} from "@/application/restaurant";
import { SendMessageUseCase, PollMessagesUseCase } from "@/application/messaging";
import { SubmitRatingUseCase } from "@/application/rating";
import { OrderUseCases } from "@/application/order/OrderUseCases";
import { SessionUseCases } from "@/application/session/SessionUseCases";
import { CashierUseCases } from "@/application/cashier/CashierUseCases";
import { DeliveryUseCases } from "@/application/delivery/DeliveryUseCases";
import { VipUseCases } from "@/application/vip/VipUseCases";
import { ScheduleUseCases } from "@/application/staff/ScheduleUseCases";
import { MenuAdminUseCases } from "@/application/menu/MenuAdminUseCases";
import { AnalyticsUseCases } from "@/application/analytics/AnalyticsUseCases";
import { PushSubscriptionUseCases } from "@/application/push/PushSubscriptionUseCases";
import { CronUseCases } from "@/application/cron/CronUseCases";
import { LivePollUseCases } from "@/application/realtime/LivePollUseCases";
import { AdminUseCases } from "@/application/admin/AdminUseCases";
import { UpsellUseCases } from "@/application/upsell/UpsellUseCases";

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
  menuRead: new MenuReadUseCase(),
  menuAdmin: new MenuAdminUseCases(),
  authenticateStaff: new AuthenticateStaffUseCase(staffAuth),
  clockInOut: new ClockInOutUseCase(shiftRepo, clock),
  staffManagement: new StaffManagementUseCase(),
  schedule: new ScheduleUseCases(),
  getCurrentRestaurant: new GetCurrentRestaurantUseCase(restaurantRepo),
  updateRestaurantConfig: new UpdateRestaurantConfigUseCase(restaurantRepo),
  tableManagement: new TableManagementUseCase(restaurantRepo),
  sendMessage: new SendMessageUseCase(messageRepo),
  pollMessages: new PollMessagesUseCase(messageRepo),
  submitRating: new SubmitRatingUseCase(ratingRepo),
  orders: new OrderUseCases(),
  sessions: new SessionUseCases(),
  cashier: new CashierUseCases(),
  delivery: new DeliveryUseCases(),
  vip: new VipUseCases(),
  analytics: new AnalyticsUseCases(),
  pushSubs: new PushSubscriptionUseCases(),
  cron: new CronUseCases(),
  livePoll: new LivePollUseCases(),
  admin: new AdminUseCases(),
  upsell: new UpsellUseCases(),
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

// Note: the transitional `legacyDb` escape hatch was removed once every
// API route was migrated to call use cases. Reintroducing it would
// re-open the layering hole this architecture exists to close — write
// a new use-case method instead.
