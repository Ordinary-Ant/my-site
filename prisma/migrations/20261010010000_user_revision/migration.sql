ALTER TABLE "users" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "users_email_case_insensitive_key" ON "users" (lower("email"));
