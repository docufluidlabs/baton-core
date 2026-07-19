/** Slugify heading text into an id. Shared by the TOC and the search index so
 *  result deep-links (#heading) line up with the rendered headings. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
