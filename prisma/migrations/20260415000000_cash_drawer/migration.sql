-- CreateTable
CREATE TABLE "CashDrawer" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloat" DOUBLE PRECISION NOT NULL,
    "closingCount" DOUBLE PRECISION,
    "expectedCash" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "CashDrawer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDrawer_restaurantId_openedAt_idx" ON "CashDrawer"("restaurantId", "openedAt");

-- CreateIndex
CREATE INDEX "CashDrawer_cashierId_openedAt_idx" ON "CashDrawer"("cashierId", "openedAt");

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
