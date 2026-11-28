/* Archivo estático: conserva las URLs y fechas originales de Blogger. */
export async function fetchArchive() {
  const response = await fetch('/archivo/catalog.json');
  if (!response.ok) throw new Error(`Archivo no disponible (${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Catálogo de archivo inválido');
  return rows.map((row) => ({
    id: `archive:${row.path}`,
    archivePath: row.path,
    isArchive: true,
    title: row.title,
    excerpt: row.description,
    author: row.author,
    publishedAt: row.date,
    cover: row.cover || '',
    tags: ['Archivo', ...(row.tags || []).filter((tag) => tag !== 'Archivo')],
    categories: row.categories || [],
  }));
}

/* Firestore covers are base64 data URIs; the build already published them as
   image files. Keep the static file URL so live cards do not inline them. */
export function preferStaticCovers(initial, live) {
  const covers = new Map(initial.filter(a => a.id && a.cover && !String(a.cover).startsWith('data:')).map(a => [a.id, a.cover]));
  return live.map(a => (String(a.cover || '').startsWith('data:') && covers.has(a.id) ? { ...a, cover: covers.get(a.id) } : a));
}

export function newestFirst(articles) {
  const timestamp = (value) => {
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  };
  return [...articles].sort((a, b) => timestamp(b.publishedAt || b.createdAt) - timestamp(a.publishedAt || a.createdAt));
}
