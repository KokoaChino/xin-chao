import overrides from './asset-overrides.json';
import type { Avatar, CharacterSummary } from '../types';

// Apply curated image corrections after cache reads as well as network updates.
export function applyAssetOverrides<T extends CharacterSummary>(character: T): T {
  const images = overrides.characters as Record<string, { avatar: Avatar }>;
  const avatar = images[character.id]?.avatar || images[character.identityId]?.avatar;
  return avatar ? { ...character, avatar: { ...avatar } } : character;
}
