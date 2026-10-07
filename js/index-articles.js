/* Keep real initial cards visible while the optional live source loads. */
import { articleCard } from "./render-article.js";
import { newestFirst } from "./archive-catalog.js";
const grid = document.getElementById("home-articles");
const initial = JSON.parse(document.getElementById("initial-articles").textContent);
(async () => {
  try {
    const { fetchPublished } = await import("./db.js");
    const live = await fetchPublished();
    if (!live.length) return;
    const articles = newestFirst([...new Map([...initial, ...live].map(a => [a.archivePath || a.id, a])).values()]).slice(0, 4);
    const cards = articles.map(a => articleCard(a, { revealed: true, reactions: true }));
    grid.replaceChildren(...cards);
  } catch (err) {
    console.warn("Se conserva el catálogo inicial; fuente en vivo no disponible.", err);
  }
})();
