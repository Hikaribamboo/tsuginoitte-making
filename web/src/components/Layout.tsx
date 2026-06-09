import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MobileModeProvider } from './MobileModeContext';

const MOBILE_MODE_STORAGE_KEY = 'making-mobile-mode';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const autoMobileRef = React.useRef(
    typeof window !== 'undefined'
      && window.localStorage.getItem(MOBILE_MODE_STORAGE_KEY) === null
      && window.matchMedia('(max-width: 768px), (pointer: coarse)').matches,
  );
  const autoWorkspaceRedirectRef = React.useRef(autoMobileRef.current);
  const [mobileMode, setMobileModeState] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem(MOBILE_MODE_STORAGE_KEY);
    if (stored !== null) return stored === 'true';
    return autoMobileRef.current;
  });

  const navItems = [
    { path: '/making', label: '作問スタジオ' },
    { path: '/workspaces', label: '下書き一覧' },
    { path: '/production', label: '本番問題' },
  ];

  const setMobileMode = React.useCallback((enabled: boolean) => {
    setMobileModeState(enabled);
    window.localStorage.setItem(MOBILE_MODE_STORAGE_KEY, String(enabled));
  }, []);

  React.useEffect(() => {
    document.body.classList.toggle('mobile-mode', mobileMode);
    return () => document.body.classList.remove('mobile-mode');
  }, [mobileMode]);

  React.useEffect(() => {
    if (!autoWorkspaceRedirectRef.current) return;
    window.localStorage.setItem(MOBILE_MODE_STORAGE_KEY, 'true');
    if (location.pathname === '/workspaces') {
      autoWorkspaceRedirectRef.current = false;
      return;
    }
    if (location.pathname === '/' || location.pathname === '/making') {
      navigate('/workspaces', { replace: true });
      return;
    }
    autoWorkspaceRedirectRef.current = false;
  }, [location.pathname, navigate]);

  const activeNav = location.pathname === '/paste-problem' || location.pathname === '/problem'
    ? navItems[1]
    : navItems.find((item) => isActivePath(location.pathname, item.path)) ?? navItems[0];

  return (
    <MobileModeProvider value={{ mobileMode, setMobileMode }}>
      <div className={mobileMode ? 'mobile-app-shell min-h-screen' : 'min-h-screen'}>
        {mobileMode ? (
          <header className="mobile-topbar">
            <Link to="/workspaces" className="mobile-icon-button" aria-label="下書き一覧" title="下書き一覧">
              <GridIcon />
            </Link>
            <label className="mobile-mode-select-wrap">
              <span className="sr-only">表示画面</span>
              <select
                value={activeNav.path}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'pc-mode') {
                    setMobileMode(false);
                    return;
                  }
                  navigate(value);
                }}
                className="mobile-mode-select"
              >
                {navItems.map((item) => (
                  <option key={item.path} value={item.path}>{item.label}</option>
                ))}
                <option value="pc-mode">PCモードに戻す</option>
              </select>
            </label>
            <Link to="/production" className="mobile-icon-button" aria-label="本番問題一覧" title="本番問題一覧">
              <ListIcon />
            </Link>
          </header>
        ) : (
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
            <button
              type="button"
              onClick={() => setMobileMode(true)}
              className="ml-auto border-slate-500 bg-slate-700 px-3 py-1 text-sm font-semibold text-white hover:bg-slate-600"
            >
              スマホモード
            </button>
          </header>
        )}
        <main className={mobileMode ? 'mobile-main' : 'px-6 py-4 max-w-[1800px] mx-auto'}>{children}</main>
      </div>
    </MobileModeProvider>
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

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="4" cy="6" r="1.5" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="4" cy="18" r="1.5" />
      <path d="M8 6h13M8 12h13M8 18h13" />
    </svg>
  );
}
