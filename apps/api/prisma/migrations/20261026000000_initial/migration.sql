CREATE TABLE "News" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "summary" TEXT,
  "content" TEXT NOT NULL,
  "imageUrl" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "News_slug_key" ON "News"("slug");
CREATE INDEX "News_published_createdAt_idx" ON "News"("published", "createdAt");

CREATE TABLE "Event" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "location" TEXT,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3),
  "imageUrl" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Event_published_startDate_idx" ON "Event"("published", "startDate");

CREATE TABLE "TeamMember" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "bio" TEXT,
  "photoUrl" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "socials" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TeamMember_order_idx" ON "TeamMember"("order");

CREATE TABLE "Admin" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Admin_username_key" ON "Admin"("username");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
