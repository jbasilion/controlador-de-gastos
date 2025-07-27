import React, { useState } from 'react';
import { auth } from './firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLogin(); // Redireciona após login
    } catch (err) {
      setError('Email ou senha inválidos.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
      <form onSubmit={handleLogin} className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-md w-full max-w-sm">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800 dark:text-gray-200">Entrar</h2>
        <input type="email" placeholder="Email" required className="w-full mb-4 px-4 py-2 border rounded dark:bg-gray-700 dark:text-white" value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Senha" required className="w-full mb-4 px-4 py-2 border rounded dark:bg-gray-700 dark:text-white" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">Acessar</button>
      </form>
    </div>
  );
}
