import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─── CONFIGURA AQUÍ TUS CREDENCIALES DE FIREBASE ───────────────────────────
// 1. Ve a https://console.firebase.google.com
// 2. Crea un proyecto → Realtime Database → Reglas: true/true para empezar
// 3. Ajustes del proyecto → Tus apps → Web → Copia el objeto firebaseConfig
const firebaseConfig = {
  apiKey:            "AIzaSyAwn36DFEVfQU9hXoGLbnuOWTC2jrs0z-I",
  authDomain:        "mi-bar-1ba15.firebaseapp.com",
  databaseURL:       "https://mi-bar-1ba15-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "mi-bar-1ba15",
  storageBucket:     "mi-bar-1ba15.firebasestorage.app",
  messagingSenderId: "1089422596150",
  appId:             "1:1089422596150:web:4c913802d5eb8f034da097"
};
// ────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getDatabase(app);

export const authReady = new Promise((resolve, reject) => {
  let settled = false;

  onAuthStateChanged(auth, user => {
    if (!settled && user) {
      settled = true;
      resolve(user);
    }
  });

  signInAnonymously(auth).catch(err => {
    if (!settled) {
      settled = true;
      reject(err);
    }
  });
});
