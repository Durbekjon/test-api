-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "user_id" TEXT;

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
