import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import batonLogo from '@/assets/baton.svg';

interface LegalLayoutProps {
  title: string;
  updatedAt: string;
  children: ReactNode;
}

export function LegalLayout({ title, updatedAt, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <a href="https://app.iambaton.com" className="flex items-center gap-2">
            <img src={batonLogo} alt="Baton" className="h-7 w-7" />
            <span className="font-semibold text-gray-900">Baton</span>
          </a>
          <nav className="hidden gap-6 text-sm text-gray-600 sm:flex">
            <a href="https://fluidlabs.com/privacy-policy" className="hover:text-gray-900">Privacy</a>
            <a href="https://fluidlabs.com/terms-of-use" className="hover:text-gray-900">Terms</a>
            <Link to="/subprocessors" className="hover:text-gray-900">Subprocessors</Link>
            <a href="https://fluidlabs.com/contact" className="hover:text-gray-900">Contact</a>
            <a href="https://app.iambaton.com" className="font-medium text-blue-600 hover:text-blue-700">
              Sign in →
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
        <p className="mb-10 text-sm text-gray-500">Last updated: {updatedAt}</p>

        <article className="legal-content">
          {children}
        </article>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-6 py-6 text-xs text-gray-500 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Fluidlabs OÜ</span>
          <div className="flex gap-4">
            <a href="mailto:app-support@fluidlabs.com" className="hover:text-gray-700">app-support@fluidlabs.com</a>
            <a href="https://fluidlabs.com/contact" className="hover:text-gray-700">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
