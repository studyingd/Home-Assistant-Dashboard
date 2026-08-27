import { useEffect, useMemo, useState } from 'react';
import { APP_VERSION } from '../lib/version';
import { fanKeywordScore, findFanSelect } from '../lib/fanSelect';
import { useHass } from '../ha/useHass';
import { useDashboardConfig } from '../hooks/useDashboardConfig';
import { Dialog } from './ui/Dialog';
import { fetchDatabase, saveDatabase, type DatabaseConnectionInfo } from '../lib/database';
import { Icon } from '../icons';

interface SettingsDialogProps {
  onClose: () => void;
  onDatabaseUpdated?: () => void;
}

export function SettingsDialog({ onClose, onDatabaseUpdated }: SettingsDialogProps) {
  const { haVersion, connStatus, states, entityDevice } = useHass();
  const { resetToSeed } = useDashboardConfig();
  const [resetArmed, setResetArmed] = useState(false);
  const [database, setDatabase] = useState<DatabaseConnectionInfo | null>(null);
  const [dbForm, setDbForm] = useState({ host: '', port: '5432', database: 'ha_dashboard', user: 'ha_dashboard', password: '', ssl: false });
  const [dbSaving, setDbSaving] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  useEffect(() => { fetchDatabase().then((value) => { setDatabase(value); setDbForm((prev) => ({ ...prev, host: value.host || prev.host, port: String(value.port || prev.port), database: value.database || prev.database, user: value.user || prev.user, ssl: value.ssl === true })); }).catch((error) => setDbError(error instanceof Error ? error.message : '数据库状态读取失败')); }, []);
  const saveDb = async () => { setDbSaving(true); setDbError(null); try { const value = await saveDatabase({ ...dbForm, port: Number(dbForm.port) }); setDatabase(value); setDbForm((prev) => ({ ...prev, password: '' })); onDatabaseUpdated?.(); } catch (error) { setDbError(error instanceof Error ? error.message : '数据库连接失败'); } finally { setDbSaving(false); } };

  /** 诊断:每台空调的风速匹配结果 + 全部风速相关 select 实体 */
  const diag = useMemo(() => {
    if (!states) return null;
    const lines: string[] = ['【空调风速匹配】'];
    const climates = Object.values(states)
      .filter((e) => e.entity_id.startsWith('climate.'))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    for (const c of climates) {
      const attrs = c.attributes as Record<string, unknown>;
      const fanModes = Array.isArray(attrs.fan_modes) ? (attrs.fan_modes as string[]) : [];
      // 与卡片渲染逻辑一致:无论是否自带 fan_modes 都先找挡位 select,找到即优先显示
      const { entity, via } = findFanSelect(c.entity_id, states, entityDevice);
      if (entity) {
        const viaLabel =
          via === 'device' ? '同设备关联' : via === 'stem' ? '词干配对' : '实体ID匹配';
        lines.push(
          `${c.entity_id} → ${entity.entity_id}(${viaLabel})` +
            (fanModes.length > 0
              ? `,挡位 select 优先于自带 fan_modes(${fanModes.join('/')})`
              : ''),
        );
      } else if (fanModes.length > 0) {
        lines.push(`${c.entity_id}:无挡位 select,用自带 fan_modes(${fanModes.join('/')})`);
      } else {
        lines.push(
          `${c.entity_id}:未找到挡位(设备关联: ${entityDevice?.get(c.entity_id) ?? '无'})`,
        );
      }
    }
    const fanSelects = Object.values(states)
      .filter(
        (e) =>
          e.entity_id.startsWith('select.') &&
          fanKeywordScore(
            `${e.entity_id} ${((e.attributes as Record<string, unknown>)?.friendly_name as string) ?? ''}`,
          ) !== -1,
      )
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    lines.push('', '【HA 中名称含风速的 select 实体】');
    if (fanSelects.length === 0) lines.push('(无)');
    for (const s of fanSelects) lines.push(s.entity_id);
    return lines.join('\n');
  }, [states, entityDevice]);

  const handleReset = () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    resetToSeed();
    onClose();
  };

  return (
    <Dialog
      title="设置"
      onClose={onClose}
      wide
      className="settings-dialog"
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <section className="settings-section settings-overview">
        <div className="settings-section__heading"><span className="settings-section__icon"><Icon name="wifi" size={15} /></span><div><h3>连接概览</h3><p>查看当前服务连接状态与运行环境。</p></div></div>
        <div className="settings-status-grid">
          <div className="settings-status-card"><span>PostgreSQL</span><strong className={database?.connected ? 'is-good' : 'is-bad'}>{database?.connected ? '已连接' : database?.configured ? '连接失败' : '未配置'}</strong><small>{database?.host ? `${database.host}:${database.port}` : '需要管理员配置'}</small></div>
          <div className="settings-status-card"><span>Home Assistant</span><strong className={connStatus === 'connected' ? 'is-good' : ''}>{connStatus === 'connected' ? '已连接' : connStatus}</strong><small>{haVersion ? `版本 ${haVersion}` : '服务端安全代理'}</small></div>
        </div>
        <p className="settings-note">访问令牌仅保存在服务端，不会下发到浏览器。</p>
      </section>

      <section className="settings-section settings-database-section">
        <div className="settings-section__heading"><span className="settings-section__icon"><Icon name="folder" size={15} /></span><div><h3>数据库连接</h3><p>切换数据库前会先测试连接，并自动创建所需数据表。</p></div></div>
        <div className="database-form">
          <label className="field database-form__host"><span>主机地址</span><input value={dbForm.host} placeholder="127.0.0.1" autoComplete="off" onChange={(e) => setDbForm({ ...dbForm, host: e.target.value })} /></label>
          <label className="field database-form__port"><span>端口</span><input type="number" min="1" max="65535" value={dbForm.port} onChange={(e) => setDbForm({ ...dbForm, port: e.target.value })} /></label>
          <label className="field database-form__database"><span>数据库名</span><input value={dbForm.database} onChange={(e) => setDbForm({ ...dbForm, database: e.target.value })} /></label>
          <label className="field database-form__user"><span>用户名</span><input value={dbForm.user} autoComplete="username" onChange={(e) => setDbForm({ ...dbForm, user: e.target.value })} /></label>
          <label className="field database-form__password"><span>密码</span><input type="password" value={dbForm.password} autoComplete="new-password" placeholder="请输入数据库密码" onChange={(e) => setDbForm({ ...dbForm, password: e.target.value })} /></label>
          <label className="visibility-toggle database-form__ssl"><input type="checkbox" checked={dbForm.ssl} onChange={(e) => setDbForm({ ...dbForm, ssl: e.target.checked })} />启用 SSL</label>
          {dbError && <p className="panel-card__error" role="alert">{dbError}</p>}
          <button type="button" className="btn primary database-form__submit" disabled={dbSaving || !dbForm.host || !dbForm.password} onClick={saveDb}>{dbSaving ? '连接测试中…' : '测试并保存数据库'}</button>
        </div>
      </section>

      <details className="settings-section settings-collapsible">
        <summary><span className="settings-section__heading"><span className="settings-section__icon"><Icon name="search" size={15} /></span><span><h3>诊断信息</h3><p>用于排查设备状态和风速挡位问题。</p></span></span><span className="settings-collapsible__chevron">›</span></summary>
        <div className="settings-diagnostics">
          <div className="settings-diagnostic-grid"><span>看板版本<strong>{APP_VERSION}</strong></span><span>实体注册表<strong>{entityDevice === null ? '加载中…' : entityDevice.size > 0 ? `已加载 ${entityDevice.size} 条` : '不可用'}</strong></span><span>实体总数<strong>{states ? Object.keys(states).length : '加载中…'}</strong></span></div>
          <pre className="diag__pre">{diag ?? '正在等待实体数据…'}</pre>
          <p className="picker-hint">如果空调风速不显示，请复制上方诊断信息发送给开发者。</p>
        </div>
      </details>

      <details className="settings-section settings-collapsible settings-danger-zone">
        <summary><span className="settings-section__heading"><span className="settings-section__icon"><Icon name="alert-triangle" size={15} /></span><span><h3>危险操作</h3><p>重置会丢弃当前所有区域、区域块和设备改动。</p></span></span><span className="settings-collapsible__chevron">›</span></summary>
        <p className="settings-danger-copy">恢复为初始示例配置后，当前布局无法自动找回，请确认已经备份。</p>
        <button type="button" className={`btn${resetArmed ? ' danger' : ''}`} onClick={handleReset} onBlur={() => setResetArmed(false)}>{resetArmed ? '再点一次确认重置' : '重置区域配置'}</button>
      </details>
    </Dialog>
  );
}
