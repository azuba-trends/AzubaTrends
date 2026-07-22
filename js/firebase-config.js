import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// Your Firebase project config now lives in config/firebase-config.json —
// setting up a new Firebase project (or rotating keys) means editing that
// one JSON file, not this code. (Note: Firebase's apiKey is designed to be
// public in client-side apps — see the _comment in that file for why this
// isn't a secret the way an ImgBB/EmailJS key is. Real access control is
// firestore.rules.)
async function loadFirebaseConfig() {
  const res = await fetch("/config/firebase-config.json");
  if (!res.ok) throw new Error("Could not load config/firebase-config.json (HTTP " + res.status + ")");
  const cfg = await res.json();
  delete cfg._comment;
  return cfg;
}

const firebaseConfig = await loadFirebaseConfig();

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Make it available globally for other admin scripts
window.FirebaseApp = { auth, db, storage, signInWithEmailAndPassword, onAuthStateChanged, signOut };
