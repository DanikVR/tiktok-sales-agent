/** Absolute URL for a locally stored upload (used by the Instagram gateway client). */
export function toAbsolutePublicMediaUrl(url: string | null | undefined, _base?: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;
}
