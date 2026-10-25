import { useEffect, useState } from 'react';
import { imageUrl } from '../utils/display';

interface Props {
  src?: string | null;
  fallback?: string;
  name: string;
  size?: number;
  className?: string;
  eager?: boolean;
}

export default function CharacterImage({ src, fallback, name, size = 320, className = '', eager = false }: Props) {
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [src, fallback]);
  const source = failed === 0 ? src : failed === 1 ? fallback : undefined;
  if (!source) return <span className={`image-placeholder ${className}`} aria-label={name}>{name.slice(0, 1)}</span>;
  return (
    <img
      className={className}
      src={imageUrl(source, size)}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed((value) => value + 1)}
    />
  );
}
