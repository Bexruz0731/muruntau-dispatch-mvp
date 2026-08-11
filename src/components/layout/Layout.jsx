import { NavLink, Outlet } from 'react-router-dom';

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
  }`;

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      <header className="h-16 flex items-center gap-4 px-4 bg-slate-900 text-white shrink-0">
        <img src="/logo.svg" alt="Зийрак ИИ" className="h-8 w-8" />
        <span className="font-semibold text-lg">Зийрак ИИ — Мурунтау</span>
        <nav className="ml-auto flex gap-2">
          <NavLink to="/map" className={linkClass}>Карта</NavLink>
          <NavLink to="/fuel-report" className={linkClass}>Отчёт по топливу</NavLink>
          <NavLink to="/assistant" className={linkClass}>ИИ-ассистент</NavLink>
        </nav>
      </header>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
