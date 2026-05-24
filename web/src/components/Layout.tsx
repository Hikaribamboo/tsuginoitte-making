import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();

  const navItems = [
    { path: '/making', label: '作問スタジオ' },
    { path: '/workspaces', label: '下書き一覧' },
    { path: '/production', label: '本番問題' },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-slate-800 text-white px-6 py-2 flex items-center gap-8">
        <h1 className="text-base font-semibold whitespace-nowrap">次の一手 問題作成ツール</h1>
        <nav className="flex gap-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`text-slate-300 no-underline text-sm px-2 py-1 rounded transition-all hover:text-white hover:bg-white/10 ${isActivePath(location.pathname, item.path) ? 'text-white bg-white/10' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="px-6 py-4 max-w-[1800px] mx-auto">{children}</main>
    </div>
  );
};

function isActivePath(pathname: string, tabPath: string): boolean {
  if (tabPath === '/making') {
    return pathname === '/making' || (pathname.startsWith('/making/') && pathname !== '/making/production');
  }
  if (tabPath === '/production') {
    return pathname === '/production' || pathname === '/making/production';
  }
  return pathname === tabPath || pathname.startsWith(`${tabPath}/`);
}

export default Layout;
