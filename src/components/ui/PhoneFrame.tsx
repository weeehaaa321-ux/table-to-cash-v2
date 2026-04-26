"use client";

// Constrains customer-facing pages to phone width on desktop.
// On mobile, it's invisible — full width.
// On desktop, it renders a centered phone-shaped container.

export function PhoneFrame({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div className={`min-h-dvh lg:flex lg:items-center lg:justify-center ${dark ? "bg-black" : "bg-sand-100"}`}>
      <div className="relative w-full max-w-[430px] min-h-dvh mx-auto lg:min-h-0 lg:h-[min(900px,92dvh)] lg:rounded-[2rem] lg:overflow-hidden lg:shadow-2xl lg:ring-1 lg:ring-white/10">
        {children}
      </div>
    </div>
  );
}
