import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// Yahan apni original apiKey daalna mat bhulna
const firebaseConfig = {
  apiKey: "AIzaSyBimjySQnhOfYCnQV0Drdx3wRb0x173bbs", 
  authDomain: "azubatrends-32349.firebaseapp.com",
  projectId: "azubatrends-32349",
  storageBucket: "azubatrends-32349.firebasestorage.app",
  messagingSenderId: "767815210504",
  appId: "1:767815210504:web:39a81e27237fc66e29a3bd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Make it available globally for other admin scripts
window.FirebaseApp = { auth, db, storage, signInWithEmailAndPassword, onAuthStateChanged, signOut };