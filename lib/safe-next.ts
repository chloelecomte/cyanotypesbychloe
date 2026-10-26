/** Only allow same-site paths as post-login destinations (no `//evil.com` or `https://…`). */
export function safeNext(next: string | string[] | null | undefined, fallback = '/tools/negative-studio') {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
