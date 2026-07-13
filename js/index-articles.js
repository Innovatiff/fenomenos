/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — index-articles.js
   Sección «Últimos artículos» de la portada: carga los 4 publicados más
   recientes desde Firestore.
   ══════════════════════════════════════════════════════════════════════════ */

import { startAnalytics } from "./firebase-init.js";
import { fetchPublished } from "./db.js";
import { articleCard } from "./render-article.js";

/* señal para el watchdog de la página: los módulos remotos cargaron */
window.__fdcModuleOk = true;

startAnalytics();

const grid = document.getElementById("home-articles");
const empty = document.getElementById("home-articles-empty");

(async () => {
  try {
    const articles = await fetchPublished();
    grid.textContent = "";

    if (!articles.length) {
      empty.classList.add("is-visible");
      return;
    }

    articles
      .slice(0, 4)
      .forEach((a) => grid.appendChild(articleCard(a, { revealed: true })));
  } catch (err) {
    console.error("No se pudieron cargar los artículos:", err);
    grid.textContent = "";
    empty.classList.add("is-visible");
  }
})();
