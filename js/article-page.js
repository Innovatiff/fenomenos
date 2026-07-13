/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — article-page.js
   Reader público: carga el artículo indicado en ?id= y lo renderiza con el
   renderizador compartido. Solo se muestran artículos publicados.
   ══════════════════════════════════════════════════════════════════════════ */

import { startAnalytics } from "./firebase-init.js";
import { fetchArticle } from "./db.js";
import { renderArticle } from "./render-article.js";

/* señal para el watchdog de la página: los módulos remotos cargaron */
window.__fdcModuleOk = true;

startAnalytics();

const root = document.getElementById("post-root");

function showState(icon, title, text) {
  root.textContent = "";
  const box = document.createElement("div");
  box.className = "post-state";

  const ic = document.createElement("ion-icon");
  ic.setAttribute("name", icon);
  box.appendChild(ic);

  const strong = document.createElement("strong");
  strong.textContent = title;
  box.appendChild(strong);

  if (text) {
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
  }
  root.appendChild(box);
}

(async () => {
  const id = new URLSearchParams(location.search).get("id");

  if (!id) {
    showState(
      "help-circle-outline",
      "Artículo no especificado",
      "El enlace no incluye ningún artículo. Vuelve al listado para elegir uno."
    );
    return;
  }

  try {
    const article = await fetchArticle(id);

    if (!article || article.status !== "published") {
      showState(
        "cloud-offline-outline",
        "Artículo no disponible",
        "Este artículo no existe o todavía no ha sido publicado."
      );
      return;
    }

    renderArticle(root, article);

    document.title = article.title + " | Fenómenos del Caribe";
    if (article.excerpt) {
      const meta = document.getElementById("meta-description");
      if (meta) meta.setAttribute("content", article.excerpt);
    }
  } catch (err) {
    console.error("No se pudo cargar el artículo:", err);
    showState(
      "cloud-offline-outline",
      "No pudimos cargar el artículo",
      "Revisa tu conexión e intenta de nuevo."
    );
  }
})();
