// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // Added getFirestore
import { getFunctions, httpsCallable } from "firebase/functions"; // Added getFunctions and httpsCallable
import { getStorage } from "firebase/storage"; // Added getStorage

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyAXbxWOx55fcf2b2dA03SCuHVbfeBxKrmc",
  authDomain: "coffeeradar-415f2.firebaseapp.com",
  projectId: "coffeeradar-415f2",
  storageBucket: "coffeeradar-415f2.firebasestorage.app",
  messagingSenderId: "1056804480515",
  appId: "1:1056804480515:web:fe0e0e62f6ba0c4b50d036",
  measurementId: "G-DF02468X9W"
};

const hasRequiredFirebaseConfig = Boolean(
  firebaseConfig.apiKey
    && firebaseConfig.projectId
    && firebaseConfig.appId
);
export const firebaseEnabled = hasRequiredFirebaseConfig;

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
// export const analytics = getAnalytics(app); // Analytics might not be needed in all environments
export const auth = getAuth(app);
export const db = getFirestore(app); // Initialized Firestore
export const functions = getFunctions(app); // Initialized Functions
export const storage = getStorage(app); // Initialized Storage

// Define callable functions
export const isAdminCallable = httpsCallable(functions, 'isAdmin');

export const ensureAuth = async (): Promise<string> => {
    const user = auth.currentUser;
    if (user) {
        return user.uid;
    }
    // If there's no current user, wait for the auth state to change.
    // This is useful for the initial load.
    return new Promise((resolve, reject) => {
        const unsubscribe = auth.onAuthStateChanged(user => {
            unsubscribe();
            if (user) {
                resolve(user.uid);
            } else {
                reject(new Error("User not authenticated"));
            }
        });
    });
};
