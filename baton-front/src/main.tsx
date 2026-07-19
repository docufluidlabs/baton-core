import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './lib/error-reporter'; // Global error handlers
import { initClarity } from './lib/clarity';
import { AuthProvider } from './auth/AuthContext';

initClarity();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);
