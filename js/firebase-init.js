/* ══════════════════════════════════════════════════════════════════════════
   FENÓMENOS DEL CARIBE — firebase-init.js
   Un solo punto de inicialización de Firebase para todo el sitio.
   ══════════════════════════════════════════════════════════════════════════ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAKCDt1PFSDf0fynqXQneZLKgeTyBGKoVQ",
  authDomain: "fenomenos-61255.firebaseapp.com",
  projectId: "fenomenos-61255",
  storageBucket: "fenomenos-61255.firebasestorage.app",
  messagingSenderId: "573171021948",
  appId: "1:573171021948:web:7aabb8b87f00a57fbcb1f9",
};

export const app = initializeApp(firebaseConfig);
