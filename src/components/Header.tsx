import { useEffect, useState } from 'react';
import { DASHBOARD_TITLE } from '../config/dashboard';
import type { Region } from '../lib/types';
import { fetchDeviceHealthSummary } from '../lib/health';
import { RegionNav } from './RegionNav';
import { ConnectionStatus } from './ConnectionStatus';
import { IconButton } from './ui/IconButton';

interface HeaderProps {
  regions: Region[];
  activeRegionId: string | null;
  editMode: boolean;
  /** 只读模式(用户页):隐藏编辑与设置入口 */
  readOnly?: boolean;
  onSelectRegion: (id: string) => void;
  onCreateRegion: () => void;
  onEditRegion: (region: Region) => void;
  onDeleteRegion: (region: Region) => void;
  onMoveRegion: (dragId: string, targetId: string, after: boolean) => void;
  onToggleEdit: () => void;
  onOpenSettings: () => void;
  onOpenAutomations: () => void;
  /** 退出管理页登录(仅管理页传入) */
  onLogoutAdmin?: () => void;
}

export function Header({
  regions,
  activeRegionId,
  editMode,
  readOnly = false,
  onSelectRegion,
  onCreateRegion,
  onEditRegion,
  onDeleteRegion,
  onMoveRegion,
  onToggleEdit,
  onOpenSettings,
  onOpenAutomations,
  onLogoutAdmin,
}: HeaderProps) {
  const firstRegionId = regions[0]?.id;
  // 管理页齿轮角标:后台定时体检的异常设备数(仅管理员;接口失败静默降级为无角标)
  const [healthProblems, setHealthProblems] = useState(0);
  useEffect(() => {
    if (readOnly) return undefined;
    let cancelled = false;
    const load = () => { void fetchDeviceHealthSummary().then((summary) => { if (!cancelled && summary) setHealthProblems(summary.problemCount); }); };
    load();
    const timer = window.setInterval(load, 5 * 60_000);
    window.addEventListener('ha:health-refresh', load);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('ha:health-refresh', load); };
  }, [readOnly]);

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <button
          type="button"
          className="app-header__title"
          aria-label="回到第一个区域"
          title="回到第一个区域"
          onClick={() => firstRegionId && onSelectRegion(firstRegionId)}
        >
          {DASHBOARD_TITLE}
        </button>
        {(regions.length > 0 || editMode) && (
          <RegionNav
            regions={regions}
            activeRegionId={activeRegionId}
            editMode={editMode}
            onSelectRegion={onSelectRegion}
            onCreateRegion={onCreateRegion}
            onEditRegion={onEditRegion}
            onDeleteRegion={onDeleteRegion}
            onMoveRegion={onMoveRegion}
          />
        )}
        <div className="app-header__actions">
          <ConnectionStatus />
          {!readOnly && (
            <>
              <IconButton
                icon={editMode ? 'check' : 'pencil'}
                label={editMode ? '完成编辑' : '编辑区域和设备'}
                active={editMode}
                onClick={onToggleEdit}
              />
              <IconButton icon="clock" label="定时自动化" onClick={onOpenAutomations} />
              <span className="header-icon-badge">
                <IconButton icon="gear" label={healthProblems > 0 ? `设置（${healthProblems} 个设备异常）` : '设置'} onClick={onOpenSettings} />
                {healthProblems > 0 && <span className="header-icon-badge__dot" aria-hidden="true">{healthProblems > 99 ? '99+' : healthProblems}</span>}
              </span>
            </>
          )}
          {onLogoutAdmin && (
            <IconButton icon="log-out" label="退出管理页" onClick={onLogoutAdmin} />
          )}
        </div>
      </div>
    </header>
  );
}
