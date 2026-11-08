"use client";
import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

// Lazy so the build can prerender pages without Firebase env vars.
let app: FirebaseApp | undefined;
const fbApp = () => (app ??= getApps()[0] ?? initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}));
let authInst: Auth | undefined;
let dbInst: Firestore | undefined;
export const fbAuth = () => (authInst ??= getAuth(fbApp()));
export const fbDb = () => (dbInst ??= getFirestore(fbApp()));

/** Calls our API with the signed-in user's ID token. Throws with the server's message on failure. */
export async function api<T = unknown>(path: string, init: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const token = await fbAuth().currentUser?.getIdToken();
  const headers: Record<string, string> = { authorization: `Bearer ${token ?? ""}` };
  let body: BodyInit | undefined;
  if (init.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(init.json); }
  if (init.form) body = init.form;
  const r = await fetch(path, { method: init.method ?? (body ? "POST" : "GET"), headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Request failed (${r.status})`);
  return j as T;
}
