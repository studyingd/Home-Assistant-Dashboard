import { useEffect, useState } from 'react';
import { isManagementPath } from './lib/adminAuth';
import { fetchSession, logoutAdmin } from './lib/session';
import { HassProvider } from './ha/HassProvider';
import { DashboardConfigProvider } from './hooks/useDashboardConfig';
import { Dashboard } from './components/Dashboard';
import { AdminLogin } from './components/AdminLogin';

const management = isManagementPath();

export default function App() {
  const [checkingSession, setCheckingSession] = useState(management);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (!management) return;
    let cancelled = false;
    fetchSession().then((session) => {
      if (!cancelled) {
        setAdmin(session.authenticated);
        setCheckingSession(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!management) return;
    const expire = () => setAdmin(false);
    const conflict = () => {
      window.alert('看板配置已被其他管理员修改。为避免覆盖他人改动，页面将重新加载。');
      window.location.reload();
    };
    window.addEventListener('ha:session-expired', expire);
    window.addEventListener('ha:config-conflict', conflict);
    return () => {
      window.removeEventListener('ha:session-expired', expire);
      window.removeEventListener('ha:config-conflict', conflict);
    };
  }, []);

  if (checkingSession) {
    return (
      <div className="fullscreen-panel" role="status" aria-live="polite">
        <div className="session-loading">
          <span className="session-loading__spinner" aria-hidden="true" />
          正在验证管理员会话…
        </div>
      </div>
    );
  }
  if (management && !admin) return <AdminLogin onSuccess={() => setAdmin(true)} />;

  const handleLogout = management
    ? async () => {
        await logoutAdmin();
        setAdmin(false);
      }
    : undefined;

  return (
    <HassProvider key={admin ? 'admin' : 'employee'}>
      <DashboardConfigProvider canEdit={admin}>
        <Dashboard readOnly={!admin} onLogoutAdmin={handleLogout} />
      </DashboardConfigProvider>
    </HassProvider>
  );
}
