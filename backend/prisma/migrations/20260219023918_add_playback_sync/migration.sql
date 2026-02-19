-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostParticipantId" TEXT,
    "maxSongs" INTEGER,
    "durationMinutes" INTEGER,
    "currentSongId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "playbackStatus" TEXT NOT NULL DEFAULT 'PAUSED',
    "playbackStartedAt" DATETIME,
    "playbackOffsetSec" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);
INSERT INTO "new_Party" ("code", "createdAt", "currentSongId", "durationMinutes", "endedAt", "hostParticipantId", "id", "maxSongs", "name", "status") SELECT "code", "createdAt", "currentSongId", "durationMinutes", "endedAt", "hostParticipantId", "id", "maxSongs", "name", "status" FROM "Party";
DROP TABLE "Party";
ALTER TABLE "new_Party" RENAME TO "Party";
CREATE UNIQUE INDEX "Party_code_key" ON "Party"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
