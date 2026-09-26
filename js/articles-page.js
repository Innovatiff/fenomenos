/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — articles-page.js
   Listado público de artículos: carga los publicados desde Firestore,
   pinta filtros por etiqueta (con conteo) y búsqueda instantánea.
   ══════════════════════════════════════════════════════════════════════════ */

import { fetchPublished, fetchTags } from "./db.js";
import { fetchArchive, newestFirst } from "./archive-catalog.js";
import { articleCard, articleTagList, normalizeText } from "./render-article.js";

/* señal para el watchdog de la página: los módulos remotos cargaron */
window.__fdcModuleOk = true;

const grid = document.getElementById("articles-grid");
const filters = document.getElementById("tag-filters");
const empty = document.getElementById("catalog-empty");
const emptyText = document.getElementById("catalog-empty-text");
const search = document.getElementById("search");

let articles = [];
let activeTag = "";
let term = "";
let visibleLimit = 24;
const moreButton = document.createElement("button");
moreButton.type = "button";
moreButton.className = "btn btn--ghost";
moreButton.textContent = "Mostrar más artículos";
moreButton.hidden = true;
grid.after(moreButton);
moreButton.addEventListener("click", () => {
  visibleLimit += 24;
  renderGrid();
});

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
    visibleLimit = 24;
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
  return normalizeText(haystack).includes(term);
}

function renderGrid() {
  grid.textContent = "";
  const visible = articles.filter(matches);

  visible.slice(0, visibleLimit).forEach((a) =>
    grid.appendChild(articleCard(a, { revealed: true, reactions: true }))
  );

  moreButton.hidden = visible.length <= visibleLimit;
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
  term = normalizeText(search.value);
  visibleLimit = 24;
  renderGrid();
});

/* ?categoria=X — llega desde las páginas de cobertura: restringe todo el
   listado (chips, conteos y búsqueda) a esa categoría */
const CATEGORY_PARAM = new URLSearchParams(location.search).get("categoria");

function showCategoryNote() {
  const bar = document.querySelector(".catalog__bar");
  if (!bar) return;
  const note = document.createElement("div");
  note.className = "cat-filter-note";
  const icon = document.createElement("ion-icon");
  icon.setAttribute("name", "folder-open-outline");
  note.appendChild(icon);
  note.appendChild(
    document.createTextNode("Mostrando artículos de " + CATEGORY_PARAM)
  );
  const clear = document.createElement("a");
  clear.href = "articulos.html";
  clear.className = "cat-filter-note__clear";
  clear.textContent = "Quitar filtro ✕";
  note.appendChild(clear);
  bar.parentNode.insertBefore(note, bar);
}

(async () => {
  try {
    const [liveResult, archiveResult, tagsResult] = await Promise.allSettled([
      fetchPublished(), fetchArchive(), fetchTags(),
    ]);
    if (liveResult.status === "rejected" && archiveResult.status === "rejected") {
      throw new Error("No se pudo cargar ninguna fuente de artículos");
    }
    const published = liveResult.status === "fulfilled" ? liveResult.value : [];
    const archive = archiveResult.status === "fulfilled" ? archiveResult.value : [];
    const tags = tagsResult.status === "fulfilled" ? tagsResult.value : [];
    const labels = new Map(tags.map((tag) => [normalizeText(tag), tag]));
    articles = newestFirst([...published, ...archive]).map((article) => ({
      ...article,
      tags: [...new Set(articleTagList(article).map((tag) => {
        const key = normalizeText(tag);
        if (!labels.has(key)) labels.set(key, tag);
        return labels.get(key);
      }))],
    }));
    if (liveResult.status === "rejected" || archiveResult.status === "rejected") {
      const notice = document.createElement("p");
      notice.setAttribute("role", "status");
      notice.textContent = "Parte del catálogo no está disponible. Puedes consultar los artículos cargados e intentar de nuevo más tarde.";
      grid.before(notice);
    }
    if (CATEGORY_PARAM) {
      const want = normalizeText(CATEGORY_PARAM);
      articles = articles.filter((a) =>
        (a.categories || []).some((c) => normalizeText(c) === want)
      );
      showCategoryNote();
    }
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
