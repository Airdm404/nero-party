import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { env } from "./env.js";
import { prisma } from "./prisma.js";

type PartySnapshot = Awaited<ReturnType<typeof getPartySnapshot>>;

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const parseOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const generatePartyCode = async (): Promise<string> => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 10; i += 1) {
    let code = "";
    for (let j = 0; j < 6; j += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const existing = await prisma.party.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!existing) {
      return code;
    }
  }
  throw new Error("Could not generate unique party code");
};

const getPartySnapshot = async (code: string) => {
  const party = await prisma.party.findUnique({
    where: { code },
    include: {
      participants: {
        orderBy: { joinedAt: "asc" },
      },
      songs: {
        orderBy: { queuePosition: "asc" },
        include: {
          votes: {
            select: {
              participantId: true,
            },
          },
        },
      },
    },
  });

  if (!party) {
    return null;
  }

  return {
    party: {
      id: party.id,
      code: party.code,
      name: party.name,
      hostParticipantId: party.hostParticipantId,
      maxSongs: party.maxSongs,
      durationMinutes: party.durationMinutes,
      currentSongId: party.currentSongId,
      status: party.status,
      playbackStatus: party.playbackStatus,
      playbackStartedAt: party.playbackStartedAt,
      playbackOffsetSec: party.playbackOffsetSec,
      createdAt: party.createdAt,
      endedAt: party.endedAt,
    },
    participants: party.participants,
    songs: party.songs.map((song) => ({
      id: song.id,
      partyId: song.partyId,
      addedById: song.addedById,
      title: song.title,
      artist: song.artist,
      artworkUrl: song.artworkUrl,
      previewUrl: song.previewUrl,
      externalUrl: song.externalUrl,
      queuePosition: song.queuePosition,
      createdAt: song.createdAt,
      voteCount: song.votes.length,
      voterIds: song.votes.map((vote) => vote.participantId),
    })),
  };
};

const requireHost = async (
  partyId: string,
  participantId: string,
): Promise<boolean> => {
  const participant = await prisma.participant.findFirst({
    where: {
      id: participantId,
      partyId,
      isHost: true,
    },
    select: { id: true },
  });
  return Boolean(participant);
};

const emitPartySnapshot = async (partyCode: string) => {
  const snapshot = await getPartySnapshot(partyCode);
  if (!snapshot) {
    return;
  }
  io.to(partyCode).emit("party:snapshot", snapshot);
};

app.post("/api/parties", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    const hostName = String(req.body?.hostName ?? "").trim();
    const maxSongs = parseOptionalNumber(req.body?.maxSongs);
    const durationMinutes = parseOptionalNumber(req.body?.durationMinutes);

    if (!name || !hostName) {
      return res.status(400).json({
        error: "name and hostName are required",
      });
    }

    const code = await generatePartyCode();

    const result = await prisma.$transaction(async (tx) => {
      const party = await tx.party.create({
        data: {
          code,
          name,
          maxSongs,
          durationMinutes,
        },
      });

      const participant = await tx.participant.create({
        data: {
          partyId: party.id,
          name: hostName,
          isHost: true,
        },
      });

      await tx.party.update({
        where: { id: party.id },
        data: { hostParticipantId: participant.id },
      });

      return { party, participant };
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to create party" });
  }
});

app.post("/api/parties/:code/join", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const name = String(req.body?.name ?? "").trim();

    if (!name) {
      return res.status(400).json({ error: "name is required" });
    }

    const party = await prisma.party.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
      },
    });

    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }

    if (party.status === "ENDED") {
      return res.status(409).json({ error: "Party already ended" });
    }

    const participant = await prisma.participant.create({
      data: {
        partyId: party.id,
        name,
        isHost: false,
      },
    });

    await emitPartySnapshot(code);

    return res.status(200).json({ party, participant });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return res.status(409).json({
        error: "That display name is already in use in this party",
      });
    }
    console.error(error);
    return res.status(500).json({ error: "Failed to join party" });
  }
});

app.get("/api/parties/:code", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const snapshot = await getPartySnapshot(code);

    if (!snapshot) {
      return res.status(404).json({ error: "Party not found" });
    }

    return res.status(200).json(snapshot);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to load party" });
  }
});

app.post("/api/parties/:code/songs", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const participantId = String(req.body?.participantId ?? "");
    const title = String(req.body?.title ?? "").trim();
    const artist = String(req.body?.artist ?? "").trim();
    const artworkUrl = String(req.body?.artworkUrl ?? "").trim() || null;
    const previewUrl = String(req.body?.previewUrl ?? "").trim() || null;
    const externalUrl = String(req.body?.externalUrl ?? "").trim() || null;

    if (!participantId || !title || !artist) {
      return res
        .status(400)
        .json({ error: "participantId, title and artist are required" });
    }

    const party = await prisma.party.findUnique({
      where: { code },
      include: {
        songs: {
          select: { id: true },
        },
      },
    });

    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }
    if (party.status === "ENDED") {
      return res.status(409).json({ error: "Party already ended" });
    }

    const participant = await prisma.participant.findFirst({
      where: {
        id: participantId,
        partyId: party.id,
      },
      select: { id: true },
    });

    if (!participant) {
      return res.status(403).json({ error: "Participant is not in this party" });
    }

    if (party.maxSongs !== null && party.maxSongs !== undefined) {
      if (party.songs.length >= party.maxSongs) {
        return res.status(409).json({ error: "Party has reached max songs" });
      }
    }

    const queuePosition = party.songs.length + 1;

    const song = await prisma.song.create({
      data: {
        partyId: party.id,
        addedById: participantId,
        title,
        artist,
        artworkUrl,
        previewUrl,
        externalUrl,
        queuePosition,
      },
    });

    await emitPartySnapshot(code);
    io.to(code).emit("queue:updated", { songId: song.id });

    return res.status(201).json({
      ...song,
      voteCount: 0,
      voterIds: [],
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to add song" });
  }
});

app.post("/api/parties/:code/votes", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const participantId = String(req.body?.participantId ?? "");
    const songId = String(req.body?.songId ?? "");

    if (!participantId || !songId) {
      return res
        .status(400)
        .json({ error: "participantId and songId are required" });
    }

    const party = await prisma.party.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }
    if (party.status === "ENDED") {
      return res.status(409).json({ error: "Party already ended" });
    }

    const [participant, song] = await Promise.all([
      prisma.participant.findFirst({
        where: { id: participantId, partyId: party.id },
        select: { id: true },
      }),
      prisma.song.findFirst({
        where: { id: songId, partyId: party.id },
        select: { id: true },
      }),
    ]);

    if (!participant) {
      return res.status(403).json({ error: "Participant is not in this party" });
    }
    if (!song) {
      return res.status(404).json({ error: "Song not found in this party" });
    }

    const existingVote = await prisma.vote.findFirst({
      where: {
        songId,
        participantId,
      },
      select: { id: true },
    });

    let voted = false;
    if (existingVote) {
      await prisma.vote.delete({
        where: { id: existingVote.id },
      });
      voted = false;
    } else {
      await prisma.vote.create({
        data: {
          partyId: party.id,
          songId,
          participantId,
        },
      });
      voted = true;
    }

    const voteCount = await prisma.vote.count({
      where: { songId },
    });

    io.to(code).emit("votes:updated", { songId, voteCount });
    await emitPartySnapshot(code);

    return res.status(200).json({ songId, voteCount, voted });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to update vote" });
  }
});

app.post("/api/parties/:code/current-song", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const participantId = String(req.body?.participantId ?? "");
    const songId = String(req.body?.songId ?? "");

    if (!participantId || !songId) {
      return res
        .status(400)
        .json({ error: "participantId and songId are required" });
    }

    const party = await prisma.party.findUnique({
      where: { code },
      select: { id: true, status: true },
    });
    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }
    if (party.status === "ENDED") {
      return res.status(409).json({ error: "Party already ended" });
    }

    const isHost = await requireHost(party.id, participantId);
    if (!isHost) {
      return res.status(403).json({ error: "Only host can change current song" });
    }

    const song = await prisma.song.findFirst({
      where: { id: songId, partyId: party.id },
      select: { id: true },
    });
    if (!song) {
      return res.status(404).json({ error: "Song not found in this party" });
    }

    const updated = await prisma.party.update({
      where: { id: party.id },
      data: {
        currentSongId: songId,
        playbackStatus: "PAUSED",
        playbackStartedAt: null,
        playbackOffsetSec: 0,
      },
    });

    io.to(code).emit("party:state-updated", {
      currentSongId: updated.currentSongId,
      status: updated.status,
    });
    await emitPartySnapshot(code);

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to set current song" });
  }
});

app.post("/api/parties/:code/playback", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const participantId = String(req.body?.participantId ?? "");
    const action = String(req.body?.action ?? "").toUpperCase();
    const incomingOffsetSec = Number(req.body?.offsetSec);

    if (!participantId || !action) {
      return res
        .status(400)
        .json({ error: "participantId and action are required" });
    }

    const party = await prisma.party.findUnique({
      where: { code },
      select: {
        id: true,
        status: true,
        playbackStatus: true,
        playbackStartedAt: true,
        playbackOffsetSec: true,
      },
    });

    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }
    if (party.status === "ENDED") {
      return res.status(409).json({ error: "Party already ended" });
    }

    const isHost = await requireHost(party.id, participantId);
    if (!isHost) {
      return res.status(403).json({ error: "Only host can control playback" });
    }

    const now = new Date();
    const startedAtMs = party.playbackStartedAt
      ? party.playbackStartedAt.getTime()
      : null;
    const elapsedSec =
      party.playbackStatus === "PLAYING" && startedAtMs
        ? Math.max(0, (now.getTime() - startedAtMs) / 1000)
        : 0;
    const currentOffsetSec = party.playbackOffsetSec + elapsedSec;

    let playbackStatus = party.playbackStatus;
    let playbackStartedAt: Date | null = party.playbackStartedAt;
    let playbackOffsetSec = currentOffsetSec;

    if (action === "PLAY") {
      const playFrom = Number.isFinite(incomingOffsetSec)
        ? Math.max(0, incomingOffsetSec)
        : currentOffsetSec;
      playbackStatus = "PLAYING";
      playbackStartedAt = now;
      playbackOffsetSec = playFrom;
    } else if (action === "PAUSE") {
      const pauseAt = Number.isFinite(incomingOffsetSec)
        ? Math.max(0, incomingOffsetSec)
        : currentOffsetSec;
      playbackStatus = "PAUSED";
      playbackStartedAt = null;
      playbackOffsetSec = pauseAt;
    } else {
      return res.status(400).json({ error: "action must be PLAY or PAUSE" });
    }

    const updated = await prisma.party.update({
      where: { id: party.id },
      data: {
        playbackStatus,
        playbackStartedAt,
        playbackOffsetSec,
      },
      select: {
        playbackStatus: true,
        playbackStartedAt: true,
        playbackOffsetSec: true,
      },
    });

    const payload = {
      playbackStatus: updated.playbackStatus,
      playbackStartedAt: updated.playbackStartedAt,
      playbackOffsetSec: updated.playbackOffsetSec,
    };

    io.to(code).emit("party:playback-updated", payload);
    await emitPartySnapshot(code);

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to update playback state" });
  }
});

app.post("/api/parties/:code/end", async (req, res) => {
  try {
    const code = String(req.params.code ?? "").toUpperCase();
    const participantId = String(req.body?.participantId ?? "");

    if (!participantId) {
      return res.status(400).json({ error: "participantId is required" });
    }

    const party = await prisma.party.findUnique({
      where: { code },
      include: {
        songs: {
          orderBy: { queuePosition: "asc" },
        },
      },
    });
    if (!party) {
      return res.status(404).json({ error: "Party not found" });
    }
    if (party.status === "ENDED") {
      return res.status(409).json({ error: "Party already ended" });
    }

    const isHost = await requireHost(party.id, participantId);
    if (!isHost) {
      return res.status(403).json({ error: "Only host can end party" });
    }

    const voteCounts = await prisma.vote.groupBy({
      by: ["songId"],
      where: { partyId: party.id },
      _count: { _all: true },
    });
    const voteCountMap = new Map<string, number>(
      voteCounts.map((entry) => [entry.songId, entry._count._all]),
    );

    const standings = party.songs
      .map((song) => ({
        songId: song.id,
        title: song.title,
        artist: song.artist,
        voteCount: voteCountMap.get(song.id) ?? 0,
        queuePosition: song.queuePosition,
      }))
      .sort((a, b) => {
        if (b.voteCount !== a.voteCount) {
          return b.voteCount - a.voteCount;
        }
        return a.queuePosition - b.queuePosition;
      })
      .map((song, index) => ({
        ...song,
        rank: index + 1,
      }));

    const winner = standings[0] ?? null;

    await prisma.party.update({
      where: { id: party.id },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    const payload = {
      winner,
      finalStandings: standings,
    };

    io.to(code).emit("party:ended", payload);
    io.to(code).emit("party:state-updated", {
      status: "ENDED",
    });
    await emitPartySnapshot(code);

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to end party" });
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("party:join-room", async (payload: { partyCode?: string }) => {
    const partyCode = String(payload?.partyCode ?? "").toUpperCase();
    if (!partyCode) {
      return;
    }

    const snapshot: PartySnapshot = await getPartySnapshot(partyCode);
    if (!snapshot) {
      socket.emit("party:not-found", { partyCode });
      return;
    }

    socket.join(partyCode);
    socket.emit("party:snapshot", snapshot);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
