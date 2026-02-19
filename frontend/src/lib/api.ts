const API_BASE = "http://localhost:3000/api";

export type Party = {
  id: string;
  code: string;
  name: string;
  hostParticipantId: string | null;
  maxSongs: number | null;
  durationMinutes: number | null;
  currentSongId: string | null;
  status: string;
  playbackStatus: string;
  playbackStartedAt: string | null;
  playbackOffsetSec: number;
  createdAt: string;
  endedAt: string | null;
};

export type Participant = {
  id: string;
  partyId: string;
  name: string;
  isHost: boolean;
  joinedAt: string;
};

export type Song = {
  id: string;
  partyId: string;
  addedById: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string | null;
  externalUrl: string | null;
  queuePosition: number;
  createdAt: string;
  voteCount: number;
  voterIds: string[];
};

export type PartySnapshot = {
  party: Party;
  participants: Participant[];
  songs: Song[];
};

export type EndPartyResult = {
  winner: {
    songId: string;
    title: string;
    artist: string;
    voteCount: number;
    queuePosition: number;
    rank: number;
  } | null;
  finalStandings: Array<{
    songId: string;
    title: string;
    artist: string;
    voteCount: number;
    queuePosition: number;
    rank: number;
  }>;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
};

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const message =
      typeof payload.error === "string" ? payload.error : "Request failed";
    throw new Error(message);
  }

  return payload as T;
}

export async function createParty(input: {
  name: string;
  hostName: string;
  maxSongs?: number | null;
  durationMinutes?: number | null;
}): Promise<{ party: Party; participant: Participant }> {
  return request("/parties", { method: "POST", body: input });
}

export async function joinParty(
  code: string,
  name: string,
): Promise<{ party: Pick<Party, "id" | "code" | "name" | "status">; participant: Participant }> {
  return request(`/parties/${code}/join`, {
    method: "POST",
    body: { name },
  });
}

export async function getParty(code: string): Promise<PartySnapshot> {
  return request(`/parties/${code}`);
}

export async function addSong(
  code: string,
  input: {
    participantId: string;
    title: string;
    artist: string;
    artworkUrl?: string | null;
    previewUrl?: string | null;
    externalUrl?: string | null;
  },
): Promise<Song> {
  return request(`/parties/${code}/songs`, {
    method: "POST",
    body: input,
  });
}

export async function toggleVote(
  code: string,
  participantId: string,
  songId: string,
): Promise<{ songId: string; voteCount: number; voted: boolean }> {
  return request(`/parties/${code}/votes`, {
    method: "POST",
    body: { participantId, songId },
  });
}

export async function setCurrentSong(
  code: string,
  participantId: string,
  songId: string,
): Promise<Party> {
  return request(`/parties/${code}/current-song`, {
    method: "POST",
    body: { participantId, songId },
  });
}

export async function updatePlayback(
  code: string,
  participantId: string,
  action: "PLAY" | "PAUSE",
  offsetSec?: number,
): Promise<{
  playbackStatus: string;
  playbackStartedAt: string | null;
  playbackOffsetSec: number;
}> {
  return request(`/parties/${code}/playback`, {
    method: "POST",
    body: { participantId, action, offsetSec },
  });
}

export async function endParty(
  code: string,
  participantId: string,
): Promise<EndPartyResult> {
  return request(`/parties/${code}/end`, {
    method: "POST",
    body: { participantId },
  });
}
