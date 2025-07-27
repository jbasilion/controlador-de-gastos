import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCJ4BklmoO5Hwtfg5VaXuiZ38t_4jpMhR0",
  authDomain: "controlador-de-gastos-ae6d4.firebaseapp.com",
  projectId: "controlador-de-gastos-ae6d4",
  storageBucket: "controlador-de-gastos-ae6d4.firebasestorage.app",
  messagingSenderId: "751056868394",
  appId: "1:751056868394:web:50c21431696fa035899f53",
  measurementId: "G-6RCN79FBZM"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
