import { Suspense } from "react";
import { ImmersiveMenu } from "@/components/menu/ImmersiveMenu";
import { JoinRequestOverlay } from "@/components/ui/JoinRequestOverlay";
import { FloatingCart } from "@/components/ui/FloatingCart";
import { CallWaiterButton } from "@/components/ui/CallWaiterButton";
import { VipMenuInit } from "@/components/ui/VipMenuInit";

export default async function MenuRoute(props: {
  searchParams: Promise<{ table?: string; restaurant?: string; session?: string; slug?: string; sessionId?: string; vip?: string; vipGuestId?: string; vipName?: string; orderType?: string }>;
}) {
  const searchParams = await props.searchParams;
  const table = searchParams.table ?? "0";
  const restaurant = searchParams.restaurant || searchParams.slug;
  const session = searchParams.session || searchParams.sessionId;
  const isVip = searchParams.vip === "1";

  // Block direct /menu navigation. A real guest always arrives via /scan
  // (which mints a session and forwards to /menu?session=...&table=...).
  // Without that handshake the page would default to "table 0" and let
  // someone order against no real session — refuse and tell them to scan.
  if (!isVip && (!session || !table || table === "0")) {
    return (
      <div className="min-h-dvh bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-8 text-center shadow-2xl">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-status-warn-50 border border-status-warn-200 flex items-center justify-center mb-4">
            <svg className="w-7 h-7 text-status-warn-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m0 14v1m8-8h-1M5 12H4m13.66-5.66l-.7.7M6.34 17.66l-.7.7m12.02 0l-.7-.7M6.34 6.34l-.7-.7M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-text-primary mb-2">Scan your table&apos;s QR</h1>
          <p className="text-sm text-text-secondary leading-relaxed">
            The menu opens after you scan the QR code on your table. That&apos;s how we know which table to send your order to.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-black flex items-center justify-center">
      {/* Phone container — max 430px on desktop, full width on mobile */}
      <div className="relative w-full max-w-[430px] h-dvh mx-auto lg:rounded-3xl lg:overflow-hidden lg:h-[min(900px,90dvh)] lg:shadow-2xl lg:ring-1 lg:ring-white/10">
        <Suspense fallback={<div className="flex items-center justify-center h-full text-white">Loading menu...</div>}>
          {isVip && <VipMenuInit vipGuestId={searchParams.vipGuestId} vipName={searchParams.vipName} orderType={searchParams.orderType} sessionId={session} />}
          <ImmersiveMenu tableNumber={table} restaurantSlug={restaurant} sessionId={session} />
          <FloatingCart />
          {!isVip && <CallWaiterButton />}
          {!isVip && <JoinRequestOverlay />}
        </Suspense>
      </div>
    </div>
  );
}
