export const POSTER_WIDTH = 1920;
export const MAX_POSTER_CHARACTERS = 100;

export class PosterResourceError extends Error {
  constructor(message: string) { super(message); this.name = 'PosterResourceError'; }
}
