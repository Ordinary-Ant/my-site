CREATE TABLE "upload_intents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "hash" TEXT NOT NULL,
  "alt" TEXT,
  "folder" TEXT NOT NULL DEFAULT '/',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "mediaId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "upload_intents_key_key" ON "upload_intents"("key");
CREATE INDEX "upload_intents_userId_expiresAt_idx" ON "upload_intents"("userId", "expiresAt");
