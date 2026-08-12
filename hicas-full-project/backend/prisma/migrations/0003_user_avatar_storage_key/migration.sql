-- Store the object-storage key separately from a public avatar URL. A null
-- key denotes an externally owned URL (such as a Google profile image).
ALTER TABLE "users"
ADD COLUMN "avatar_storage_key" TEXT;

CREATE UNIQUE INDEX "users_avatar_storage_key_key"
ON "users"("avatar_storage_key");
