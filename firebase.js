import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDL27oR7DoUyexecC9VQmkV--PTVG0ggHmE",
  authDomain: "tirelireapp-6da66.firebaseapp.com",
  projectId: "tirelireapp-6da66",
  storageBucket: "tirelireapp-6da66.firebasestorage.app",
  messagingSenderId: "488630216860",
  appId: "1:488630216860:web:177b085ecbd56859772559"
};

const app = initializeApp(firebaseConfig);

// Le "long polling" rend Firestore fiable sur téléphone (React Native).
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });
