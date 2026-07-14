/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — db.js
   Acceso de solo lectura a Firestore para las páginas públicas.
   ══════════════════════════════════════════════════════════════════════════ */

import { app } from "./firebase-init.js";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { toDateValue } from "./render-article.js";

export const db = getFirestore(app);

/* Solo `where` de igualdad (índice automático); el orden se resuelve aquí,
   así el proyecto no necesita índices compuestos. */
export async function fetchPublished() {
  const snap = await getDocs(
    query(collection(db, "articles"), where("status", "==", "published"))
  );
  const articles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  articles.sort((a, b) => {
    const da = toDateValue(a.publishedAt || a.createdAt)?.getTime() || 0;
    const dbb = toDateValue(b.publishedAt || b.createdAt)?.getTime() || 0;
    return dbb - da;
  });
  return articles;
}

export async function fetchArticle(id) {
  const snap = await getDoc(doc(db, "articles", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/* Reacciones públicas (👍 ❤️ 🔥): incremento atómico sobre el contador.
   Requiere la regla de Firestore que permite actualizar SOLO el campo
   `reactions` de artículos publicados (ver README). */
export async function reactToArticle(id, kind, delta) {
  await updateDoc(doc(db, "articles", id), {
    ["reactions." + kind]: increment(delta),
  });
}

export async function fetchTags() {
  try {
    const snap = await getDoc(doc(db, "meta", "tags"));
    const list = snap.exists() ? snap.data().list : null;
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}
