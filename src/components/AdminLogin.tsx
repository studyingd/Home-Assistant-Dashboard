import { useState, type FormEvent } from 'react';
import { loginAdmin } from '../lib/session';
import { Icon } from '../icons';

interface AdminLoginProps {
  /** 服务端登录成功后切换到管理界面 */
  onSuccess: () => void;
}

/** 管理页登录:账号 + 密码,纯前端校验,登录态存 sessionStorage */
export function AdminLogin({ onSuccess }: AdminLoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 用户看板地址 = 去掉末尾 /management(兼容子路径部署)
  const userPath = window.location.pathname.replace(/\/management\/?$/, '') || '/';

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await loginAdmin(username, password);
      onSuccess();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(
        code === 'admin_not_configured'
          ? '服务器尚未配置管理员密码，请联系系统管理员。'
          : code === 'too_many_attempts'
            ? '登录尝试过多，请 15 分钟后再试。'
            : '账号或密码错误',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fullscreen-panel">
      <form className="panel-card" onSubmit={handleSubmit}>
        <span className="panel-card__icon">
          <Icon name="lock" size={28} />
        </span>
        <h1 className="panel-card__title">管理员登录</h1>
        <p className="panel-card__desc">登录后可管理分区、设备与设置;普通看板请直接访问首页。</p>

        <div className="field">
          <label htmlFor="admin-username">账号</label>
          <input
            id="admin-username"
            type="text"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="admin-password">密码</label>
          <div className="input-with-action">
            <input
              id="admin-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              spellCheck={false}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              onClick={() => setShowPassword((v) => !v)}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
            </button>
          </div>
        </div>

        {error && <p className="panel-card__error" role="alert">{error}</p>}

        <button type="submit" className="btn primary" disabled={submitting}>
          {submitting ? '正在登录…' : '登录'}
        </button>

        <p className="panel-card__hint">
          <a href={userPath}>← 返回看板</a>
        </p>
      </form>
    </div>
  );
}
