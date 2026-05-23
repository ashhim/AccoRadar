import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

export const ADMIN_EMAIL = 'hashhash4uhell@gmail.com'

const firebaseConfig = {
  apiKey: 'AIzaSyDt7PkwfetBUGCv3N8xCm9l3xLtygo-lB8',
  authDomain: 'accoradar-4d9a9.firebaseapp.com',
  projectId: 'accoradar-4d9a9',
  storageBucket: 'accoradar-4d9a9.firebasestorage.app',
  messagingSenderId: '859225512358',
  appId: '1:859225512358:web:b4219e6b5b287d68399767',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

