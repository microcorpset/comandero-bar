import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

function _d(e,k='cmd25k'){return Array.from(atob(e),(c,i)=>String.fromCharCode(c.charCodeAt(0)^k.charCodeAt(i%k.length))).join('');}

const firebaseConfig = {
  apiKey:            _d("IiQeU2YSIhoKAQMvJSgyVGQ+WgU8XXInAQMRfWI/IF8OQEZbGUAt"),
  authDomain:        _d("DgRJUFQZTlwGUwReTQsNQFAJAh4BU0UbTQ4LXw=="),
  databaseURL:       _d("CxkQQkZRTEIJWxgJAh9JA1cKUlhJVlANAhgIRhgZFwkGHFAeEQIUVxgcBh4QAxsNCh8BUFQYBgkFRlQJAh4BHFQbEw=="),
  projectId:         _d("DgRJUFQZTlwGUwRe"),
  storageBucket:     _d("DgRJUFQZTlwGUwReTQsNQFAJAh4BQUEEEQwDVxsKEx0="),
  messagingSenderId: _d("Ul1cCwFZUVhdBAReUw=="),
  appId:             _d("UldVAg1SV19WBwxdUlhUCEIOAVdQUQxaUFVUAFFeBg9cVAVYVwkFAgxc")
};

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
