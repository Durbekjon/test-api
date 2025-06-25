-- CreateTable
CREATE TABLE "TestSettings" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "userId" TEXT,
    "shuffle_questions" BOOLEAN NOT NULL,
    "shuffle_answers" BOOLEAN NOT NULL,
    "shuffle_all" BOOLEAN NOT NULL,

    CONSTRAINT "TestSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TestSettings_testId_key" ON "TestSettings"("testId");

-- AddForeignKey
ALTER TABLE "TestSettings" ADD CONSTRAINT "TestSettings_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
