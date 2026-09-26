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

export function newestFirst(articles) {
  const timestamp = (value) => {
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0);
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  };
  return [...articles].sort((a, b) => timestamp(b.publishedAt || b.createdAt) - timestamp(a.publishedAt || a.createdAt));
}
