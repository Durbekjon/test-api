-- CreateTable
CREATE TABLE "TestVariant" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestVariant_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TestVariant" ADD CONSTRAINT "TestVariant_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
