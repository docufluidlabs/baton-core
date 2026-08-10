/**
 * Preview Entry Point — Baton
 *
 * Renders the full app with mocked API data (fetch is intercepted, so the
 * app's own auth provider sees a signed-in session).
 * Used by the singlefile build to produce a self-contained HTML.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { installMockFetch } from './mock-data';
import PreviewApp from './PreviewApp';
import '../index.css';

// Install mock fetch BEFORE any component renders
installMockFetch();

// Add a preview banner
function PreviewBanner() {
  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      right: 16,
      zIndex: 9999,
      background: '#7c3aed',
      color: 'white',
      padding: '8px 16px',
      borderRadius: 8,
      fontSize: 12,
      fontWeight: 600,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      fontFamily: 'system-ui, sans-serif',
    }}>
      Preview Mode — Sample Data
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PreviewApp />
    <PreviewBanner />
  </React.StrictMode>,
);
