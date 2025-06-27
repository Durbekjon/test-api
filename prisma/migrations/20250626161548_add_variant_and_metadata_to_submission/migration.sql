/*
  Warnings:

  - You are about to drop the column `incorrect` on the `TestSubmission` table. All the data in the column will be lost.
  - Added the required column `totalCount` to the `TestSubmission` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TestSubmission" DROP COLUMN "incorrect",
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "totalCount" INTEGER NOT NULL,
ADD COLUMN     "variantId" TEXT;

-- AddForeignKey
ALTER TABLE "TestSubmission" ADD CONSTRAINT "TestSubmission_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "TestVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
