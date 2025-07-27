import React, { useEffect, useState } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import App from './App'; // Seu App principal de finanças
import LoginPage from './LoginPage';

export default function AppRouter() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);
    });
    return () => unsubscribe();
  }, []);

  if (checking) {
    return <div className="flex items-center justify-center h-screen bg-gray-100">Verificando autenticação...</div>;
  }

  return user ? <App /> : <LoginPage onLogin={() => setUser(auth.currentUser)} />;
}
