import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  initializeFirestore, getFirestore, collection, doc, setDoc, deleteDoc, getDoc, onSnapshot, query, where, orderBy, type Firestore,
} from "firebase/firestore";
import type { ChatMessage, Trip, UserProfile } from "../types";
import type { TripStore, Unsubscribe } from "./types";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const hasFirebaseConfig = () => Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

/**
 * Firestore-backed store.
 *   users/{uid}
 *   trips/{tripId}
 *   trips/{tripId}/messages/{id}
 */
export class FirebaseStore implements TripStore {
  kind = "firebase" as const;
  private db!: Firestore;

  async init(): Promise<string> {
    const app = getApps()[0] ?? initializeApp(firebaseConfig);
    try {
      this.db = initializeFirestore(app, { ignoreUndefinedProperties: true });
    } catch {
      this.db = getFirestore(app);
    }
    const auth = getAuth(app);
    const user = await new Promise<string>((resolve, reject) => {
      const off = onAuthStateChanged(auth, async (u) => {
        off();
        try {
          resolve(u ? u.uid : (await signInAnonymously(auth)).user.uid);
        } catch (e) { reject(e); }
      });
    });
    return user;
  }

  subscribeTrips(uid: string, cb: (trips: Trip[]) => void): Unsubscribe {
    const q = query(collection(this.db, "trips"), where("ownerId", "==", uid), orderBy("updatedAt", "desc"));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as Trip)), (e) => console.error("[firestore] trips", e));
  }

  subscribeMessages(tripId: string, cb: (messages: ChatMessage[]) => void): Unsubscribe {
    const q = query(collection(this.db, "trips", tripId, "messages"), orderBy("createdAt"));
    return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as ChatMessage)), (e) => console.error("[firestore] messages", e));
  }

  async saveTrip(trip: Trip) {
    await setDoc(doc(this.db, "trips", trip.id), trip);
  }

  async deleteTrip(id: string) {
    await deleteDoc(doc(this.db, "trips", id));
  }

  async addMessage(tripId: string, message: ChatMessage) {
    await setDoc(doc(this.db, "trips", tripId, "messages", message.id), message);
  }

  async getProfile(uid: string) {
    const snap = await getDoc(doc(this.db, "users", uid));
    return snap.exists() ? (snap.data() as UserProfile) : undefined;
  }

  async saveProfile(uid: string, profile: UserProfile) {
    await setDoc(doc(this.db, "users", uid), profile, { merge: true });
  }
}
