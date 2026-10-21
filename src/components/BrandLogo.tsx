/**
 * Official Almithali logo (the bilingual badge from the company logo file, background removed).
 * Never recoloured, rotated, shadowed or stretched.
 */
const RATIO = 972 / 1254; // intrinsic ratio of the badge

export function BrandLogo({ alt, width = 160 }: { alt: string; width?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="brand-logo" src="/brand/logo.png" alt={alt} width={width} height={Math.round(width * RATIO)} />;
}
