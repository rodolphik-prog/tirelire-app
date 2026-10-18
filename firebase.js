import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import {
  getReactNativePersistence,
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyDL27oR7DoUyexeC9VQmkV--PTVG0ggHmE",
  authDomain: "tirelireapp-6da66.firebaseapp.com",
  projectId: "tirelireapp-6da66",
  storageBucket: "tirelireapp-6da66.firebasestorage.app",
  messagingSenderId: "488630216860",
  appId: "1:488630216860:web:177b085ecbd56859772559"
};

const app = initializeApp(firebaseConfig);

// Le "long polling" rend Firestore fiable sur téléphone (React Native).
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });

// Connexion anonyme : chaque téléphone reçoit un identifiant invisible, mémorisé sur le
// téléphone. C'est lui qui donne accès (ou non) à chaque tirelire.
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Renvoie l'identifiant du téléphone, en le créant la première fois.
export function connexion() {
  return new Promise((resolve, reject) => {
    const arreter = onAuthStateChanged(
      auth,
      (utilisateur) => {
        arreter();
        if (utilisateur) {
          resolve(utilisateur.uid);
        } else {
          signInAnonymously(auth).then((r) => resolve(r.user.uid), reject);
        }
      },
      reject
    );
  });
}
