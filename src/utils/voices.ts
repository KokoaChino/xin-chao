import type { Voice } from '../types';

export function uniqueVoices(voices: Voice[]): Voice[] {
  const tracks = new Map<string, Voice>();
  for (const voice of voices) {
    if (!voice.url) continue;
    const key = `${voice.language}/${voice.category}/${voice.outfitId || ''}/${voice.url}`;
    const existing = tracks.get(key);
    if (!existing) tracks.set(key, voice);
    else if ((!existing.text && voice.text) || (!existing.cv && voice.cv)) {
      tracks.set(key, { ...existing, text: existing.text || voice.text, cv: existing.cv || voice.cv });
    }
  }
  return [...tracks.values()];
}
