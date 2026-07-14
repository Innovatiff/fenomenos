/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — render-article.js
   Renderizador compartido de artículos. Lo usan la página pública del
   artículo (articulo.html) y la vista previa del Estudio (estudio.html),
   así que lo que el dueño ve al editar es exactamente lo que se publica.

   El contenido se inserta como nodos de texto, salvo los párrafos con
   formato (negrita, cursiva, alineación, marcador…), que se guardan como
   HTML y SIEMPRE pasan por sanitizeHtml() —una lista blanca estricta de
   etiquetas y estilos— tanto al guardar como al renderizar.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Sanitizador de HTML enriquecido ─────────────────────────────────────
   Solo sobreviven las etiquetas y estilos que produce la barra de formato
   del Estudio. Cualquier otra cosa (scripts, atributos, iframes…) se
   elimina conservando el texto. */

const RICH_TAGS = new Set([
  "P",
  "DIV",
  "BR",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "MARK",
  "SPAN",
]);
const RICH_STYLES = new Set(["text-align", "background-color"]);

function cleanNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.nodeValue);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const keepTag = RICH_TAGS.has(node.tagName);
  const target = keepTag
    ? doc.createElement(node.tagName.toLowerCase())
    : doc.createDocumentFragment();

  if (keepTag && node.getAttribute && node.getAttribute("style")) {
    const styles = [];
    for (const prop of RICH_STYLES) {
      const value = node.style.getPropertyValue(prop);
      if (value) styles.push(prop + ": " + value);
    }
    if (styles.length) target.setAttribute("style", styles.join("; "));
  }

  node.childNodes.forEach((child) => {
    const cleaned = cleanNode(child, doc);
    if (cleaned) target.appendChild(cleaned);
  });
  return target;
}

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(
    "<div>" + String(html || "") + "</div>",
    "text/html"
  );
  const out = document.createElement("div");
  doc.body.firstChild.childNodes.forEach((child) => {
    const cleaned = cleanNode(child, document);
    if (cleaned) out.appendChild(cleaned);
  });
  return out.innerHTML;
}

export function htmlToPlainText(html) {
  const div = document.createElement("div");
  div.innerHTML = sanitizeHtml(html);
  return div.textContent || "";
}

/* ── Utilidades ──────────────────────────────────────────────────────────── */

export function toDateValue(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate(); // Timestamp de Firestore
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

export function formatDate(v) {
  const d = toDateValue(v);
  if (!d) return "";
  return d.toLocaleDateString("es", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* Etiquetas del artículo, con compatibilidad con el campo antiguo `tag` */
export function articleTagList(article) {
  if (Array.isArray(article.tags) && article.tags.length) return article.tags;
  return article.tag ? [article.tag] : [];
}

export function articleWordCount(article) {
  let words = 0;
  const count = (s) => {
    if (s) words += String(s).trim().split(/\s+/).filter(Boolean).length;
  };
  count(article.title);
  count(article.excerpt);
  (article.sections || []).forEach((s) => {
    count(s.html ? htmlToPlainText(s.html) : s.text);
    count(s.caption);
    count(s.cite);
    (s.items || []).forEach(count);
  });
  count(article.footer);
  return words;
}

export function readMinutes(article) {
  return Math.max(1, Math.round(articleWordCount(article) / 200));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* Un párrafo por bloque separado con línea en blanco; los saltos simples
   dentro de un bloque se convierten en <br>. */
function paragraphs(text, className) {
  const frag = document.createDocumentFragment();
  String(text || "")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .forEach((block) => {
      const p = el("p", className);
      block.split("\n").forEach((line, i) => {
        if (i) p.appendChild(document.createElement("br"));
        p.appendChild(document.createTextNode(line));
      });
      frag.appendChild(p);
    });
  return frag;
}

/* ── Secciones ───────────────────────────────────────────────────────────── */

/* Tamaños disponibles para los subtítulos (elegibles en el Estudio) */
export const HEADING_SIZES = [
  { key: "sm", label: "Pequeño" },
  { key: "md", label: "Normal" },
  { key: "lg", label: "Grande" },
  { key: "xl", label: "Extra grande" },
];

const RENDERERS = {
  heading(section) {
    const h = el("h2", "post__heading");
    if (section.html) h.innerHTML = sanitizeHtml(section.html);
    else h.textContent = section.text || "";
    if (section.size && section.size !== "md") {
      h.classList.add("post__heading--" + section.size);
    }
    return h;
  },

  text(section) {
    const wrap = el("div", "post__text");
    if (section.html) {
      wrap.innerHTML = sanitizeHtml(section.html); // lista blanca estricta
    } else {
      wrap.appendChild(paragraphs(section.text));
    }
    return wrap;
  },

  image(section) {
    if (!section.src) return null;
    const figure = el("figure", "post__figure");
    const img = document.createElement("img");
    img.src = section.src;
    img.alt = section.caption || "";
    img.loading = "lazy";
    figure.appendChild(img);
    const captionPlain =
      section.caption || htmlToPlainText(section.captionHtml || "").trim();
    if (captionPlain) {
      const cap = el("figcaption", "post__caption");
      if (section.captionHtml) cap.innerHTML = sanitizeHtml(section.captionHtml);
      else cap.textContent = section.caption;
      figure.appendChild(cap);
    }
    return figure;
  },

  quote(section) {
    const hasHtml = section.html && htmlToPlainText(section.html).trim();
    if (!hasHtml && !section.text) return null;
    const bq = el("blockquote", "post__quote");
    if (hasHtml) bq.innerHTML = sanitizeHtml(section.html);
    else bq.appendChild(paragraphs(section.text));
    if (section.cite) bq.appendChild(el("cite", "post__cite", section.cite));
    return bq;
  },

  list(section) {
    const ul = el("ul", "post__list");
    if (Array.isArray(section.itemsHtml) && section.itemsHtml.length) {
      section.itemsHtml.forEach((h) => {
        const html = sanitizeHtml(h);
        if (!htmlToPlainText(html).trim()) return;
        const li = el("li");
        li.innerHTML = html;
        ul.appendChild(li);
      });
    } else {
      (section.items || [])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .forEach((item) => ul.appendChild(el("li", null, item)));
    }
    return ul.children.length ? ul : null;
  },
};

/** Devuelve un fragmento con el cuerpo (solo las secciones) del artículo. */
export function renderSections(sections) {
  const frag = document.createDocumentFragment();
  (sections || []).forEach((section) => {
    const render = RENDERERS[section.type];
    const node = render && render(section);
    if (node) frag.appendChild(node);
  });
  return frag;
}

/** Renderiza el artículo completo (cabecera + cuerpo + pie) dentro de `root`. */
export function renderArticle(root, article) {
  root.textContent = "";

  const header = el("header", "post__head");

  const meta = el("div", "post__meta");
  articleTagList(article).forEach((tag) =>
    meta.appendChild(el("span", "post__tag", tag))
  );
  const when = formatDate(article.publishedAt || article.updatedAt || article.createdAt);
  if (when) meta.appendChild(el("span", "post__date", when));
  meta.appendChild(el("span", "post__read", readMinutes(article) + " min de lectura"));
  header.appendChild(meta);

  const h1 = el("h1", "heading__primary post__title");
  if (article.titleHtml && htmlToPlainText(article.titleHtml).trim()) {
    h1.innerHTML = sanitizeHtml(article.titleHtml);
  } else {
    h1.textContent = article.title || "Sin título";
  }
  header.appendChild(h1);

  const excerptPlain =
    article.excerpt || htmlToPlainText(article.excerptHtml || "").trim();
  if (excerptPlain) {
    const lead = el("p", "post__excerpt");
    if (article.excerptHtml) lead.innerHTML = sanitizeHtml(article.excerptHtml);
    else lead.textContent = article.excerpt;
    header.appendChild(lead);
  }
  root.appendChild(header);

  if (article.cover) {
    const figure = el("figure", "post__cover");
    const img = document.createElement("img");
    img.src = article.cover;
    img.alt = article.title || "";
    figure.appendChild(img);
    root.appendChild(figure);
  }

  const body = el("div", "post__body");
  body.appendChild(renderSections(article.sections));
  /* anclas para el índice («En este artículo») */
  body.querySelectorAll(".post__heading").forEach((h, i) => {
    h.id = "seccion-" + (i + 1);
  });
  root.appendChild(body);

  const footerPlain =
    article.footer || htmlToPlainText(article.footerHtml || "").trim();
  if (footerPlain) {
    const foot = el("footer", "post__footer");
    foot.appendChild(el("span", "post__footer-label", "Nota del artículo"));
    if (article.footerHtml) {
      const text = el("div", "post__footer-text");
      text.innerHTML = sanitizeHtml(article.footerHtml);
      foot.appendChild(text);
    } else {
      foot.appendChild(paragraphs(article.footer, "post__footer-text"));
    }
    root.appendChild(foot);
  }
}

/* ── Reacciones (👍 ❤️ 🔥) ───────────────────────────────────────────────── */

export const REACTIONS = [
  { key: "like", icon: "thumbs-up", label: "Me gusta" },
  { key: "love", icon: "heart", label: "Me encanta" },
  { key: "fire", icon: "flame", label: "Increíble" },
];

export function reactionCount(article, key) {
  const n = article.reactions && article.reactions[key];
  return typeof n === "number" && n > 0 ? n : 0;
}

export function formatCount(n) {
  if (n >= 1000) {
    const k = n / 1000;
    return (k >= 10 ? Math.round(k) : Math.round(k * 10) / 10) + " mil";
  }
  return String(n);
}

/* Fila compacta de solo lectura (tarjetas de la portada): únicamente las
   reacciones con al menos un clic; si no hay ninguna, no se muestra nada. */
export function reactionsSummary(article) {
  const active = REACTIONS.map(({ key, icon }) => ({
    key,
    icon,
    n: reactionCount(article, key),
  })).filter((r) => r.n > 0);
  if (!active.length) return null;

  const row = el("span", "card-reacts");
  active.forEach(({ key, icon, n }) => {
    const item = el("span", "card-reacts__item card-reacts__item--" + key);
    const ic = document.createElement("ion-icon");
    ic.setAttribute("name", icon);
    item.appendChild(ic);
    item.appendChild(el("b", null, formatCount(n)));
    row.appendChild(item);
  });
  return row;
}

/* ── Tarjeta de artículo (para las cuadrículas) ─────────────────────────── */

export function articleCard(article, { revealed = false, reactions = false } = {}) {
  const li = el("li", "card card--article" + (revealed ? "" : " reveal"));
  const a = document.createElement("a");
  a.className = "card__inner";
  a.href = "articulo.html?id=" + encodeURIComponent(article.id);

  const media = el("span", "article__media");
  if (article.cover) {
    const img = document.createElement("img");
    img.src = article.cover;
    img.alt = "";
    img.loading = "lazy";
    media.appendChild(img);
  } else {
    media.classList.add("article__media--empty");
    const icon = document.createElement("ion-icon");
    icon.setAttribute("name", "newspaper-outline");
    media.appendChild(icon);
  }
  a.appendChild(media);

  const meta = el("span", "article__meta");
  const cardTags = articleTagList(article);
  if (cardTags.length) {
    meta.appendChild(el("span", "article__tag", cardTags[0]));
    meta.appendChild(document.createTextNode(" · "));
  }
  meta.appendChild(
    document.createTextNode(formatDate(article.publishedAt || article.createdAt))
  );
  a.appendChild(meta);

  a.appendChild(el("h3", "card__title", article.title || "Sin título"));
  if (article.excerpt) a.appendChild(el("p", "card__text", article.excerpt));

  if (reactions) {
    const summary = reactionsSummary(article);
    if (summary) a.appendChild(summary);
  }

  const link = el("span", "card__link", "Leer más ");
  const arrow = document.createElement("ion-icon");
  arrow.setAttribute("name", "arrow-forward-outline");
  link.appendChild(arrow);
  a.appendChild(link);

  li.appendChild(a);
  return li;
}
