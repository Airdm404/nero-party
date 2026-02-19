import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  addSong,
  createParty,
  endParty,
  getParty,
  joinParty,
  type EndPartyResult,
  type PartySnapshot,
  setCurrentSong,
  toggleVote,
  updatePlayback,
} from "./lib/api";
import { socket } from "./lib/socket";

type Session = {
  partyCode: string;
  participantId: string;
  name: string;
};

const SESSION_KEY = "nero_party_session";
const PLAYER_ELEMENT_ID = "yt-player";

type YouTubePlayer = {
  destroy: () => void;
  getCurrentTime: () => number;
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};

type YouTubeApi = {
  Player: new (
    elementId: string,
    options: {
      videoId?: string;
      playerVars?: Record<string, number>;
      events?: {
        onReady?: () => void;
      };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

function getYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace("www.", "");

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v");
      }
      if (parsed.pathname.startsWith("/embed/")) {
        return parsed.pathname.split("/embed/")[1] ?? null;
      }
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/shorts/")[1] ?? null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function getYouTubeEmbedUrl(url: string | null | undefined): string | null {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) {
    return null;
  }
  return `https://www.youtube.com/embed/${videoId}`;
}

function getExpectedOffsetSec(party: {
  playbackStatus: string;
  playbackOffsetSec: number;
  playbackStartedAt: string | null;
}): number {
  if (party.playbackStatus !== "PLAYING" || !party.playbackStartedAt) {
    return Math.max(0, party.playbackOffsetSec);
  }

  const startedAtMs = Date.parse(party.playbackStartedAt);
  if (!Number.isFinite(startedAtMs)) {
    return Math.max(0, party.playbackOffsetSec);
  }

  const elapsedSec = (Date.now() - startedAtMs) / 1000;
  return Math.max(0, party.playbackOffsetSec + elapsedSec);
}

function ensureYouTubeApi(): Promise<YouTubeApi> {
  return new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Failed to load YouTube API"));
      document.body.appendChild(script);
    }

    window.onYouTubeIframeAPIReady = () => {
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube API unavailable"));
      }
    };
  });
}

function readSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.partyCode || !parsed.participantId || !parsed.name) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function App() {
  // Persisted user context for quick re-entry into the same party.
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [snapshot, setSnapshot] = useState<PartySnapshot | null>(null);
  const [winner, setWinner] = useState<EndPartyResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [createPartyName, setCreatePartyName] = useState("");
  const [createHostName, setCreateHostName] = useState("");
  const [maxSongs, setMaxSongs] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");

  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  const [songTitle, setSongTitle] = useState("");
  const [songArtist, setSongArtist] = useState("");
  const [songExternalUrl, setSongExternalUrl] = useState("");
  const playerRef = useRef<YouTubePlayer | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);

  // Initial fetch keeps refresh/back navigation in sync with server state.
  useEffect(() => {
    if (!session) {
      return;
    }

    setIsLoading(true);
    setError("");
    getParty(session.partyCode)
      .then((data) => {
        setSnapshot(data);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [session]);

  // Socket room subscription powers live queue/vote/winner updates.
  useEffect(() => {
    if (!session) {
      socket.disconnect();
      return;
    }

    const onSnapshot = (next: PartySnapshot) => {
      setSnapshot(next);
    };
    const onEnded = (payload: EndPartyResult) => {
      setWinner(payload);
    };
    const onPlaybackUpdated = (payload: {
      playbackStatus: string;
      playbackStartedAt: string | null;
      playbackOffsetSec: number;
    }) => {
      setSnapshot((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          party: {
            ...prev.party,
            playbackStatus: payload.playbackStatus,
            playbackStartedAt: payload.playbackStartedAt,
            playbackOffsetSec: payload.playbackOffsetSec,
          },
        };
      });
    };
    const onNotFound = () => {
      setError("Party room not found");
    };

    socket.connect();
    socket.emit("party:join-room", { partyCode: session.partyCode });
    socket.on("party:snapshot", onSnapshot);
    socket.on("party:ended", onEnded);
    socket.on("party:playback-updated", onPlaybackUpdated);
    socket.on("party:not-found", onNotFound);

    return () => {
      socket.off("party:snapshot", onSnapshot);
      socket.off("party:ended", onEnded);
      socket.off("party:playback-updated", onPlaybackUpdated);
      socket.off("party:not-found", onNotFound);
    };
  }, [session]);

  // Resolve current viewer from snapshot for host checks and vote state.
  const me = useMemo(() => {
    if (!snapshot || !session) {
      return null;
    }
    return snapshot.participants.find(
      (participant) => participant.id === session.participantId,
    );
  }, [snapshot, session]);

  const isHost = Boolean(me?.isHost);
  const currentSong = useMemo(() => {
    if (!snapshot?.party.currentSongId) {
      return null;
    }
    return (
      snapshot.songs.find((song) => song.id === snapshot.party.currentSongId) ?? null
    );
  }, [snapshot]);
  const currentSongEmbedUrl = useMemo(
    () => getYouTubeEmbedUrl(currentSong?.externalUrl),
    [currentSong?.externalUrl],
  );
  const currentVideoId = useMemo(
    () => getYouTubeVideoId(currentSong?.externalUrl),
    [currentSong?.externalUrl],
  );

  const persistSession = (next: Session) => {
    // Write-through update keeps React state and per-tab storage aligned.
    setSession(next);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  };

  const onCreateParty = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const partyPayload = await createParty({
        name: createPartyName.trim(),
        hostName: createHostName.trim(),
        maxSongs: maxSongs ? Number(maxSongs) : null,
        durationMinutes: durationMinutes ? Number(durationMinutes) : null,
      });
      persistSession({
        partyCode: partyPayload.party.code,
        participantId: partyPayload.participant.id,
        name: partyPayload.participant.name,
      });
      setJoinCode("");
      setJoinName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const onJoinParty = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const normalizedCode = joinCode.trim().toUpperCase();
      const payload = await joinParty(normalizedCode, joinName.trim());
      persistSession({
        partyCode: payload.party.code,
        participantId: payload.participant.id,
        name: payload.participant.name,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const onAddSong = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) {
      return;
    }
    setError("");
    try {
      await addSong(session.partyCode, {
        participantId: session.participantId,
        title: songTitle.trim(),
        artist: songArtist.trim(),
        externalUrl: songExternalUrl.trim() || null,
      });
      setSongTitle("");
      setSongArtist("");
      setSongExternalUrl("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onToggleVote = async (songId: string) => {
    if (!session) {
      return;
    }
    setError("");
    try {
      await toggleVote(session.partyCode, session.participantId, songId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSetCurrentSong = async (songId: string) => {
    if (!session) {
      return;
    }
    setError("");
    try {
      await setCurrentSong(session.partyCode, session.participantId, songId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onPlayNext = async () => {
    if (!snapshot || !session || snapshot.songs.length === 0) {
      return;
    }

    const index = snapshot.songs.findIndex(
      (song) => song.id === snapshot.party.currentSongId,
    );
    // Wrap to first song when current song is last or unset.
    const nextSong = snapshot.songs[index + 1] ?? snapshot.songs[0];
    await onSetCurrentSong(nextSong.id);
  };

  const onEndParty = async () => {
    if (!session) {
      return;
    }
    setError("");
    try {
      const payload = await endParty(session.partyCode, session.participantId);
      setWinner(payload);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onPlaybackControl = async (
    action: "PLAY" | "PAUSE",
    offsetSec?: number,
  ) => {
    if (!session) {
      return;
    }
    setError("");
    try {
      const payload = await updatePlayback(
        session.partyCode,
        session.participantId,
        action,
        offsetSec,
      );
      setSnapshot((prev) => {
        if (!prev) {
          return prev;
        }
        return {
          ...prev,
          party: {
            ...prev.party,
            playbackStatus: payload.playbackStatus,
            playbackStartedAt: payload.playbackStartedAt,
            playbackOffsetSec: payload.playbackOffsetSec,
          },
        };
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onLeaveParty = () => {
    setSession(null);
    setSnapshot(null);
    setWinner(null);
    setError("");
    sessionStorage.removeItem(SESSION_KEY);
    socket.disconnect();
  };

  const partyEnded = snapshot?.party.status === "ENDED";
  const isPlaying = snapshot?.party.playbackStatus === "PLAYING";

  useEffect(() => {
    if (!snapshot || !currentVideoId) {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      loadedVideoIdRef.current = null;
      return;
    }

    let isMounted = true;
    ensureYouTubeApi()
      .then((YT) => {
        if (!isMounted) {
          return;
        }

        if (!playerRef.current) {
          playerRef.current = new YT.Player(PLAYER_ELEMENT_ID, {
            videoId: currentVideoId,
            playerVars: {
              playsinline: 1,
              rel: 0,
            },
          });
          loadedVideoIdRef.current = currentVideoId;
        } else if (loadedVideoIdRef.current !== currentVideoId) {
          playerRef.current.loadVideoById(currentVideoId);
          loadedVideoIdRef.current = currentVideoId;
        }
      })
      .catch((err: Error) => {
        setError(err.message);
      });

    return () => {
      isMounted = false;
    };
  }, [currentVideoId, snapshot]);

  useEffect(() => {
    if (!snapshot || !playerRef.current || !currentVideoId) {
      return;
    }

    const expectedOffset = getExpectedOffsetSec(snapshot.party);
    const currentOffset = playerRef.current.getCurrentTime();
    const drift = Math.abs(currentOffset - expectedOffset);
    if (drift > 1.5) {
      playerRef.current.seekTo(expectedOffset, true);
    }

    if (snapshot.party.playbackStatus === "PLAYING") {
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [
    currentVideoId,
    snapshot?.party.playbackOffsetSec,
    snapshot?.party.playbackStartedAt,
    snapshot?.party.playbackStatus,
  ]);

  useEffect(() => {
    if (!snapshot || !playerRef.current || !currentVideoId) {
      return;
    }
    if (snapshot.party.playbackStatus !== "PLAYING") {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!playerRef.current) {
        return;
      }
      const expectedOffset = getExpectedOffsetSec(snapshot.party);
      const currentOffset = playerRef.current.getCurrentTime();
      if (Math.abs(currentOffset - expectedOffset) > 1.5) {
        playerRef.current.seekTo(expectedOffset, true);
      }
    }, 7000);

    return () => window.clearInterval(intervalId);
  }, [
    currentVideoId,
    snapshot?.party.playbackOffsetSec,
    snapshot?.party.playbackStartedAt,
    snapshot?.party.playbackStatus,
  ]);

  if (!session) {
    // Landing state: create new party or join an existing one.
    return (
      <main className="party-shell min-h-screen text-slate-100">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2">
          <section className="glass-card rounded-2xl p-6">
            <h1 className="text-3xl font-semibold tracking-tight">Nero Party</h1>
            <p className="mt-2 text-sm text-slate-300">
              Build a room, invite friends, vote songs, crown a winner.
            </p>
            <form className="mt-6 space-y-3" onSubmit={onCreateParty}>
              <input
                className="glass-input w-full rounded-lg px-3 py-2"
                placeholder="Party name"
                value={createPartyName}
                onChange={(event) => setCreatePartyName(event.target.value)}
                required
              />
              <input
                className="glass-input w-full rounded-lg px-3 py-2"
                placeholder="Host display name"
                value={createHostName}
                onChange={(event) => setCreateHostName(event.target.value)}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className="glass-input rounded-lg px-3 py-2"
                  placeholder="Max songs"
                  type="number"
                  min={1}
                  value={maxSongs}
                  onChange={(event) => setMaxSongs(event.target.value)}
                />
                <input
                  className="glass-input rounded-lg px-3 py-2"
                  placeholder="Duration (mins)"
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(event.target.value)}
                />
              </div>
              <button
                className="neon-btn neon-emerald w-full rounded-lg bg-emerald-300 px-3 py-2 font-semibold text-slate-900 disabled:opacity-60"
                disabled={isLoading}
              >
                Create party
              </button>
            </form>
          </section>

          <section className="glass-card rounded-2xl p-6">
            <h2 className="text-2xl font-semibold">Join existing party</h2>
            <form className="mt-6 space-y-3" onSubmit={onJoinParty}>
              <input
                className="glass-input w-full rounded-lg px-3 py-2 uppercase"
                placeholder="Party code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                required
              />
              <input
                className="glass-input w-full rounded-lg px-3 py-2"
                placeholder="Your display name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                required
              />
              <button
                className="neon-btn neon-cyan w-full rounded-lg bg-cyan-300 px-3 py-2 font-semibold text-slate-900 disabled:opacity-60"
                disabled={isLoading}
              >
                Join party
              </button>
            </form>
          </section>
        </div>
        {error ? (
          <p className="mx-auto max-w-6xl px-4 pb-8 text-sm text-rose-300">{error}</p>
        ) : null}
      </main>
    );
  }

  return (
    // In-party dashboard: participants, queue, voting, host controls, winner.
    <main className={`party-shell min-h-screen px-4 py-6 text-slate-100 ${isPlaying ? "is-playing" : ""}`}>
      <div className="mx-auto max-w-6xl">
        <header className="glass-card mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div>
            <h1 className="text-2xl font-semibold">{snapshot?.party.name ?? "Party room"}</h1>
            <p className="text-sm text-slate-300">
              Code: <span className="font-semibold tracking-widest">{session.partyCode}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-md border border-slate-700 px-2 py-1">
              You: {session.name}
            </span>
            {isHost ? (
              <span className="rounded-md bg-amber-400 px-2 py-1 font-semibold text-slate-900">
                Host
              </span>
            ) : null}
            <button
              className="glass-subtle rounded-md px-2 py-1 hover:bg-white/10"
              onClick={onLeaveParty}
            >
              Leave
            </button>
          </div>
        </header>

        {isLoading && !snapshot ? (
          <p className="text-sm text-slate-300">Loading party...</p>
        ) : null}

        {snapshot ? (
          <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <aside className="space-y-4">
              <section className="glass-card rounded-2xl p-4">
                <h2 className="text-lg font-semibold">Now playing</h2>
                {currentSong ? (
                  <div className="mt-2 text-sm">
                    <p className="font-semibold">{currentSong.title}</p>
                    <p className="text-slate-300">{currentSong.artist}</p>
                    {currentSongEmbedUrl ? (
                      <div className="mt-3 overflow-hidden rounded-xl border border-slate-700">
                        <div id={PLAYER_ELEMENT_ID} className="aspect-video w-full" />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
                        Add a YouTube URL to enable in-app playback.
                      </p>
                    )}
                    {isHost && currentSongEmbedUrl && !partyEnded ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          className="neon-btn neon-emerald rounded-md bg-emerald-300 px-2 py-1 text-xs font-semibold text-slate-900"
                          onClick={() =>
                            onPlaybackControl("PLAY", playerRef.current?.getCurrentTime() ?? 0)
                          }
                        >
                          Play
                        </button>
                        <button
                          className="neon-btn rounded-md bg-amber-300 px-2 py-1 text-xs font-semibold text-slate-900"
                          onClick={() =>
                            onPlaybackControl("PAUSE", playerRef.current?.getCurrentTime() ?? 0)
                          }
                        >
                          Pause
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-300">No song selected yet.</p>
                )}
                {isHost && snapshot.songs.length > 0 && !partyEnded ? (
                  <button
                    className="neon-btn neon-violet mt-3 w-full rounded-md bg-violet-300 px-3 py-2 text-sm font-semibold text-slate-900"
                    onClick={onPlayNext}
                  >
                    Next song
                  </button>
                ) : null}
              </section>

              <section className="glass-card rounded-2xl p-4">
                <h2 className="text-lg font-semibold">Participants</h2>
                <ul className="mt-2 space-y-2 text-sm">
                  {snapshot.participants.map((participant) => (
                    <li key={participant.id} className="flex items-center justify-between">
                      <span>{participant.name}</span>
                      {participant.isHost ? (
                        <span className="rounded bg-amber-400 px-2 py-0.5 text-xs font-semibold text-slate-900">
                          Host
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              {isHost && !partyEnded ? (
                <button
                  className="neon-btn w-full rounded-xl bg-rose-400 px-3 py-2 font-semibold text-slate-950"
                  onClick={onEndParty}
                >
                  End party and crown winner
                </button>
              ) : null}
            </aside>

            <section className="space-y-4">
              <section className="glass-card rounded-2xl p-4">
                <h2 className="text-lg font-semibold">Add song</h2>
                <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={onAddSong}>
                  <input
                    className="glass-input rounded-lg px-3 py-2"
                    placeholder="Song title"
                    value={songTitle}
                    onChange={(event) => setSongTitle(event.target.value)}
                    required
                    disabled={partyEnded}
                  />
                  <input
                    className="glass-input rounded-lg px-3 py-2"
                    placeholder="Artist"
                    value={songArtist}
                    onChange={(event) => setSongArtist(event.target.value)}
                    required
                    disabled={partyEnded}
                  />
                  <input
                    className="glass-input rounded-lg px-3 py-2"
                    placeholder="YouTube URL (optional)"
                    value={songExternalUrl}
                    onChange={(event) => setSongExternalUrl(event.target.value)}
                    disabled={partyEnded}
                  />
                  <button
                    className="neon-btn neon-cyan rounded-lg bg-cyan-300 px-3 py-2 font-semibold text-slate-900 disabled:opacity-60 md:col-span-3"
                    disabled={partyEnded}
                  >
                    Add to queue
                  </button>
                </form>
              </section>

              <section className="glass-card rounded-2xl p-4">
                <h2 className="text-lg font-semibold">Queue</h2>
                {snapshot.songs.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-300">No songs yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {snapshot.songs.map((song) => {
                      const voted = session ? song.voterIds.includes(session.participantId) : false;
                      return (
                        <li
                          key={song.id}
                          className="glass-subtle rounded-xl p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold">
                                {song.queuePosition}. {song.title}
                              </p>
                              <p className="text-sm text-slate-300">{song.artist}</p>
                              {song.externalUrl ? (
                                <a
                                  className="text-xs text-cyan-300 hover:underline"
                                  href={song.externalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open link
                                </a>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-md border border-slate-700 px-2 py-1 text-xs">
                                {song.voteCount} vote{song.voteCount === 1 ? "" : "s"}
                              </span>
                              <button
                                className="neon-btn neon-emerald rounded-md bg-emerald-300 px-2 py-1 text-xs font-semibold text-slate-900 disabled:opacity-60"
                                onClick={() => onToggleVote(song.id)}
                                disabled={partyEnded}
                              >
                                {voted ? "Unvote" : "Vote"}
                              </button>
                              {isHost && !partyEnded ? (
                                <button
                                  className="neon-btn neon-violet rounded-md bg-violet-200 px-2 py-1 text-xs font-semibold text-slate-900"
                                  onClick={() => onSetCurrentSong(song.id)}
                                >
                                  Play now
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </section>
          </div>
        ) : null}

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}

        {winner ? (
          <section className="mt-6 rounded-2xl border border-amber-400 bg-amber-200/95 p-4 text-slate-900">
            <h2 className="text-xl font-bold">Winning song</h2>
            {winner.winner ? (
              <>
                <p className="mt-1 font-semibold">
                  {winner.winner.title} - {winner.winner.artist}
                </p>
                <p className="text-sm">Votes: {winner.winner.voteCount}</p>
              </>
            ) : (
              <p className="mt-1 text-sm">No songs were added.</p>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}

export default App;
