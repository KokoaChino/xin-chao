export type ArtworkKind = 'team' | 'poster' | 'portrait' | 'skin' | 'other';

export interface Artwork {
  url: string;
  label: string;
  kind: ArtworkKind;
  width?: number;
  height?: number;
  orientation?: 'desktop' | 'mobile';
}

export interface Avatar {
  url: string;
  fallbackUrl?: string;
  width?: number;
  height?: number;
}

export interface LoreEntry {
  id: string;
  title: string;
  html: string;
  images?: string[];
}

export interface Voice {
  id: string;
  title: string;
  text: string;
  url: string;
  language: string;
  cv: string;
  category: 'personality' | 'combat' | 'outfit';
  outfitId?: string;
}

export interface Outfit {
  id: string;
  name: string;
  descriptionHtml: string;
  images: Artwork[];
  voices: Voice[];
}

export interface CharacterSummary {
  id: string;
  identityId: string;
  name: string;
  displayName: string;
  romanizedName: string;
  description: string;
  resonanceName: string;
  gender: string;
  origin: string;
  affiliation: string;
  weapon: string;
  element: string;
  releaseVersion: string;
  avatar: Avatar;
  hero: Artwork | null;
  poster: Artwork | null;
  hasOutfits: boolean;
  voiceCount: number;
  isPreview: boolean;
  wikiBadge?: string;
  sourceUrl: string;
  fetchedAt: string;
}

export interface Character extends CharacterSummary {
  identity: string;
  specialty: string;
  cv: Record<string, string>;
  artworks: Artwork[];
  archives: LoreEntry[];
  treasures: LoreEntry[];
  stories: LoreEntry[];
  outfits: Outfit[];
  voices: Voice[];
  syncWarnings: string[];
}

export interface CatalogIndex {
  schemaVersion: number;
  generatedAt: string;
  characters: CharacterSummary[];
}

export interface WikiCatalogItem {
  id: string;
  name: string;
  iconUrl?: string;
  wikiBadge?: string;
}

export type Tier = 's' | 'a' | 'b' | 'c';

export interface Preferences {
  schemaVersion: 1;
  title: string;
  subtitle: string;
  order: string[];
  notes: Record<string, string>;
  tiers: Record<string, Tier>;
  favorites: string[];
  selectedVariants?: Record<string, string>;
  updatedAt: string;
}

export interface SyncState {
  phase: 'idle' | 'checking' | 'updating' | 'done' | 'error';
  completed: number;
  total: number;
  lastSuccess: string | null;
  message: string;
}

export interface CatalogController {
  characters: CharacterSummary[];
  loading: boolean;
  error: string | null;
  sync: SyncState;
  refresh: (force?: boolean) => Promise<void>;
  getCharacter: (id: string) => Promise<Character>;
}
