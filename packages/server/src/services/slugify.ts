export function slugify(input: string, fallback = 'plan'): string {
  const lowered = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const cleaned = lowered
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = cleaned.slice(0, 80).replace(/-+$/, '');
  return truncated === '' ? fallback : truncated;
}
