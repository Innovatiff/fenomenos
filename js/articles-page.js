/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — articles-page.js
   Listado público de artículos: carga los publicados desde Firestore,
   pinta filtros por etiqueta (con conteo) y búsqueda instantánea.
   ══════════════════════════════════════════════════════════════════════════ */

import { startAnalytics } from "./firebase-init.js";
import { fetchPublished, fetchTags } from "./db.js";
import { articleCard, articleTagList } from "./render-article.js";

/* señal para el watchdog de la página: los módulos remotos cargaron */
window.__fdcModuleOk = true;

startAnalytics();

const grid = document.getElementById("articles-grid");
const filters = document.getElementById("tag-filters");
const empty = document.getElementById("catalog-empty");
const emptyText = document.getElementById("catalog-empty-text");
const search = document.getElementById("search");

let articles = [];
let activeTag = "";
let term = "";

function clearSkeletons() {
  grid.querySelectorAll(".skeleton").forEach((el) => el.remove());
}

function renderFilters(tags) {
  const counts = new Map();
  articles.forEach((a) => {
    articleTagList(a).forEach((tag) =>
      counts.set(tag, (counts.get(tag) || 0) + 1)
    );
  });

  /* Etiquetas administradas primero, luego cualquier otra que traigan los
     artículos; solo se muestran las que tienen al menos una publicación. */
  const ordered = [...tags, ...counts.keys()].filter(
    (t, i, arr) => counts.has(t) && arr.indexOf(t) === i
  );

  filters.textContent = "";
  const all = chipButton("Todos", "", articles.length);
  all.classList.add("is-active");
  filters.appendChild(all);
  ordered.forEach((tag) => filters.appendChild(chipButton(tag, tag, counts.get(tag))));
}

function chipButton(label, tag, count) {
  const btn = document.createElement("button");
  btn.className = "chip";
  btn.dataset.tag = tag;
  btn.appendChild(document.createTextNode(label));
  if (count != null) {
    const n = document.createElement("span");
    n.className = "chip__count";
    n.textContent = count;
    btn.appendChild(n);
  }
  btn.addEventListener("click", () => {
    activeTag = tag;
    filters
      .querySelectorAll(".chip")
      .forEach((c) => c.classList.toggle("is-active", c === btn));
    renderGrid();
  });
  return btn;
}

function matches(article) {
  const tags = articleTagList(article);
  if (activeTag && !tags.includes(activeTag)) return false;
  if (!term) return true;
  const haystack = [article.title, article.excerpt, ...tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(term);
}

function renderGrid() {
  grid.textContent = "";
  const visible = articles.filter(matches);

  visible.forEach((a) => grid.appendChild(articleCard(a, { revealed: true })));

  empty.classList.toggle("is-visible", visible.length === 0);
  if (!visible.length) {
    emptyText.textContent = term
      ? "Ninguna publicación coincide con tu búsqueda."
      : activeTag
        ? "Aún no hay publicaciones en esta categoría. Vuelve pronto."
        : "Aún no hay publicaciones. Vuelve pronto.";
  }
}

search.addEventListener("input", () => {
  term = search.value.trim().toLowerCase();
  renderGrid();
});

(async () => {
  try {
    const [published, tags] = await Promise.all([fetchPublished(), fetchTags()]);
    articles = published;
    clearSkeletons();
    renderFilters(tags);
    renderGrid();
  } catch (err) {
    console.error("No se pudieron cargar los artículos:", err);
    clearSkeletons();
    empty.classList.add("is-visible");
    emptyText.textContent =
      "No pudimos cargar los artículos en este momento. Intenta de nuevo más tarde.";
  }
})();
