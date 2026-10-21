export const STATUSES = ['todo', 'learning', 'shaky', 'ready'] as const;
export type Status = (typeof STATUSES)[number];

export type Link = { label: string; url: string };

export type Member = { id: string; name: string; instrument: string; color: string; createdAt: number };

export type Song = {
  id: string;
  title: string;
  artist: string;
  original: boolean;
  status: Status;
  position: number;
  key: string;
  bpm: number | null;
  duration: number | null;
  tuning: string;
  notes: string;
  links: Link[];
  /** Same-origin URL of the stored album art, if any. */
  cover: string | null;
  /** Already looked up online (cover, key, tuning, links). */
  enriched: boolean;
  lastRehearsed: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

/** 1 = lost, 2 = shaky, 3 = solid. Absent = hasn't said. */
export type Level = 1 | 2 | 3;
export type Confidence = { songId: string; memberId: string; level: Level; updatedAt: number };

/** What a member plays or sings on one song. */
export type Part = { songId: string; memberId: string; role: string };

export type ItemType = 'song' | 'break' | 'note';
export type SetlistItem = { id: string; type: ItemType; songId: string | null; text: string; done: boolean };

export type SetlistKind = 'show' | 'rehearsal';
export type Setlist = {
  id: string;
  kind: SetlistKind;
  name: string;
  date: string | null;
  time: string | null;
  venue: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  items: SetlistItem[];
};

export type Activity = {
  id: number;
  memberId: string | null;
  kind: string;
  detail: Record<string, unknown>;
  createdAt: number;
};

/** A track suggestion from the music lookup. */
export type Match = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  art: string | null;
  cover: string | null;
  deezerId: number | null;
};

export type BandState = {
  members: Member[];
  songs: Song[];
  confidence: Confidence[];
  parts: Part[];
  setlists: Setlist[];
  activity: Activity[];
};
