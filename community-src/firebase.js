import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseReady = Object.values(config).every(Boolean)
export const firebaseApp = firebaseReady ? (getApps()[0] || initializeApp(config)) : null
if (firebaseApp && import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}
export const auth = firebaseApp ? getAuth(firebaseApp) : null
export const database = firebaseApp ? getDatabase(firebaseApp) : null
// database.rules.json에 적힌 관리자 UID와 같아야 합니다.
export const ownerUid = import.meta.env.VITE_FIREBASE_OWNER_UID || 'x2PfMwkpbmQQDudDhWH5lyKkkbh1'
