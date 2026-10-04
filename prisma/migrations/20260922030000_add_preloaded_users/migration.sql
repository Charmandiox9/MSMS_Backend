CREATE TABLE "PreloadedUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreloadedUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreloadedUserRole" (
    "preloadedUserId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreloadedUserRole_pkey" PRIMARY KEY ("preloadedUserId", "roleId")
);

CREATE UNIQUE INDEX "PreloadedUser_email_key" ON "PreloadedUser"("email");
CREATE INDEX "PreloadedUserRole_roleId_idx" ON "PreloadedUserRole"("roleId");

ALTER TABLE "PreloadedUserRole" ADD CONSTRAINT "PreloadedUserRole_preloadedUserId_fkey"
    FOREIGN KEY ("preloadedUserId") REFERENCES "PreloadedUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreloadedUserRole" ADD CONSTRAINT "PreloadedUserRole_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
