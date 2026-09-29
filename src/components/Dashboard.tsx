import { lazy, Suspense, useState } from 'react';
import type { DeviceConfig, Region, RegionBlock } from '../lib/types';
import { countRegionDevices } from '../lib/regions';
import { useHass } from '../ha/useHass';
import { useDashboardConfig } from '../hooks/useDashboardConfig';
import { Header } from './Header';
import { RegionView } from './RegionView';
import { NameIconDialog } from './NameIconDialog';
import { DeviceEditDialog } from './DeviceEditDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from '../icons';

// 低频重组件懒加载:首屏只拉看板骨架,打开对应弹窗时再加载分块(Vite 自动分包)
const SettingsDialog = lazy(() => import('./SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
const DevicePickerDialog = lazy(() => import('./DevicePickerDialog').then((m) => ({ default: m.DevicePickerDialog })));
const AutomationDialog = lazy(() => import('./AutomationDialog').then((m) => ({ default: m.AutomationDialog })));
const DeviceLogsDialog = lazy(() => import('./DeviceLogsDialog').then((m) => ({ default: m.DeviceLogsDialog })));

interface DashboardProps {
  /** 只读模式(用户页):禁用全部编辑/设置入口,仅保留设备控制 */
  readOnly?: boolean;
  /** 退出管理页登录(仅管理页传入,显示退出按钮) */
  onLogoutAdmin?: () => void;
}

type DialogState =
  | { kind: 'settings' }
  | { kind: 'automations' }
  | { kind: 'create-region' }
  | { kind: 'edit-region'; region: Region }
  | { kind: 'delete-region'; region: Region }
  | { kind: 'create-block' }
  | { kind: 'edit-block'; block: RegionBlock }
  | { kind: 'delete-block'; block: RegionBlock }
  | { kind: 'edit-device'; blockId: string; device: DeviceConfig }
  | { kind: 'device-logs'; device: DeviceConfig }
  | { kind: 'picker'; block: RegionBlock }
  | null;

export function Dashboard({ readOnly = false, onLogoutAdmin }: DashboardProps) {
  const { connStatus, retry } = useHass();
  const {
    regions,
    activeRegion,
    activeRegionId,
    setActiveRegion,
    addRegion,
    changeRegion,
    deleteRegion,
    moveRegion,
    addBlock,
    changeBlock,
    deleteBlock,
    moveBlock,
    changeDevice,
    removeDevice,
    moveDevice,
    syncError,
    retrySync,
  } = useDashboardConfig();
  const [editMode, setEditMode] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const closeDialog = () => setDialog(null);
  // 只读(用户页)时强制关闭编辑模式,所有编辑入口失效
  const effectiveEditMode = !readOnly && editMode;
  const visibleRegions = readOnly ? regions.filter((region) => !region.hiddenFromUsers) : regions;
  const visibleActiveRegion = visibleRegions.find((region) => region.id === activeRegionId) ?? visibleRegions[0] ?? null;

  if (syncError) {
    return (
      <>
        <div className="fullscreen-panel">
          <div className="panel-card">
            <span className="panel-card__icon error"><Icon name="alert-triangle" size={26} /></span>
            <h1 className="panel-card__title">需要配置 PostgreSQL</h1>
            <p className="panel-card__desc">{syncError}</p>
            <div className="database-setup-actions">
              <button type="button" className="btn" onClick={retrySync}>重试</button>
              {!readOnly && <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'settings' })}>配置数据库</button>}
            </div>
          </div>
        </div>
        <Suspense fallback={null}>
          {dialog?.kind === 'settings' && <SettingsDialog onClose={closeDialog} onDatabaseUpdated={() => { closeDialog(); retrySync(); }} />}
        </Suspense>
      </>
    );
  }

  // 致命错误:整屏面板
  if (connStatus === 'auth-error') {
    return (
      <div className="fullscreen-panel">
        <div className="panel-card">
          <span className="panel-card__icon error">
            <Icon name="alert-triangle" size={26} />
          </span>
          <h1 className="panel-card__title">认证失败</h1>
          <p className="panel-card__desc">
            服务端保存的 Home Assistant 凭据无效或已被撤销，请联系系统管理员更新服务端配置。
          </p>
          <button type="button" className="btn primary" onClick={retry}>
            重试连接
          </button>
        </div>
      </div>
    );
  }

  if (connStatus === 'unreachable') {
    return (
      <div className="fullscreen-panel">
        <div className="panel-card">
          <span className="panel-card__icon error">
            <Icon name="wifi-off" size={26} />
          </span>
          <h1 className="panel-card__title">无法连接 Home Assistant</h1>
          <p className="panel-card__desc">
            请确认 HA 地址正确、服务正在运行,且本设备与 HA 在同一网络。
          </p>
          <button type="button" className="btn primary" onClick={retry}>
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {connStatus === 'reconnecting' && (
        <div className="reconnect-banner">
          <Icon name="wifi-off" size={14} />
          连接已断开,正在自动重连…
        </div>
      )}
      <Header
        regions={visibleRegions}
        activeRegionId={visibleActiveRegion?.id ?? null}
        editMode={effectiveEditMode}
        readOnly={readOnly}
        onSelectRegion={setActiveRegion}
        onCreateRegion={() => setDialog({ kind: 'create-region' })}
        onEditRegion={(region) => setDialog({ kind: 'edit-region', region })}
        onDeleteRegion={(region) => setDialog({ kind: 'delete-region', region })}
        onMoveRegion={moveRegion}
        onToggleEdit={() => setEditMode((v) => !v)}
        onOpenSettings={() => setDialog({ kind: 'settings' })}
        onOpenAutomations={() => setDialog({ kind: 'automations' })}
        onLogoutAdmin={onLogoutAdmin}
      />
      <main className="page">
        <RegionView
          region={visibleActiveRegion}
          editMode={effectiveEditMode}
          onCreateRegion={() => setDialog({ kind: 'create-region' })}
          onCreateBlock={() => setDialog({ kind: 'create-block' })}
          onEditBlock={(block) => setDialog({ kind: 'edit-block', block })}
          onDeleteBlock={(block) => setDialog({ kind: 'delete-block', block })}
          onAddDevices={(block) => setDialog({ kind: 'picker', block })}
          onEditDevice={(block, entityId) => {
            const device = block.devices.find((d) => d.entity_id === entityId);
            if (device) setDialog({ kind: 'edit-device', blockId: block.id, device });
          }}
          onOpenDeviceLogs={(device) => setDialog({ kind: 'device-logs', device })}
          onRemoveDevice={(blockId, entityId) => removeDevice(blockId, entityId)}
          onMoveBlock={moveBlock}
          onMoveDevice={moveDevice}
          readOnly={readOnly}
        />
      </main>

      <Suspense fallback={null}>
        {dialog?.kind === 'settings' && (
          <SettingsDialog onClose={closeDialog} onDatabaseUpdated={retrySync} />
        )}

        {dialog?.kind === 'automations' && (
          <AutomationDialog onClose={closeDialog} />
        )}
      </Suspense>

      {dialog?.kind === 'create-region' && (
        <NameIconDialog
          title="新建区域"
          namePlaceholder="如:客厅、卧室、书房"
          submitLabel="创建"
          withIcon={false}
          onClose={closeDialog}
          onSubmit={(name, icon) => {
            const id = addRegion(name, icon);
            closeDialog();
            setActiveRegion(id); // 新建后自动选中该区域
          }}
        />
      )}

      {dialog?.kind === 'edit-region' && (
        <NameIconDialog
          title="编辑区域"
          submitLabel="保存"
          withIcon={false}
          initialName={dialog.region.name}
          initialIcon={dialog.region.icon}
          onClose={closeDialog}
          initialHiddenFromUsers={dialog.region.hiddenFromUsers}
          onSubmit={(name, icon, hiddenFromUsers) => {
            changeRegion(dialog.region.id, { name, icon, hiddenFromUsers });
            closeDialog();
          }}
        />
      )}

      {dialog?.kind === 'delete-region' && (
        <ConfirmDialog
          title="删除区域"
          description={(() => {
            const nBlocks = dialog.region.blocks.length;
            const nDevices = countRegionDevices(dialog.region);
            const extras = [
              nBlocks > 0 ? `${nBlocks} 个区域块` : '',
              nDevices > 0 ? `${nDevices} 个设备` : '',
            ]
              .filter(Boolean)
              .join('、');
            return extras
              ? `将删除「${dialog.region.name}」及其下的 ${extras},此操作无法撤销。`
              : `将删除空区域「${dialog.region.name}」,此操作无法撤销。`;
          })()}
          confirmLabel="删除"
          onConfirm={() => {
            deleteRegion(dialog.region.id);
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}

      {dialog?.kind === 'create-block' && activeRegion && (
        <NameIconDialog
          title="新建区域块"
          namePlaceholder="如:环境、遮阳、灯光"
          submitLabel="创建"
          onClose={closeDialog}
          onSubmit={(name, icon) => {
            addBlock(activeRegion.id, name, icon);
            closeDialog();
          }}
        />
      )}

      {dialog?.kind === 'edit-block' && (
        <NameIconDialog
          title="编辑区域块"
          submitLabel="保存"
          initialName={dialog.block.name}
          initialIcon={dialog.block.icon}
          initialHiddenFromUsers={dialog.block.hiddenFromUsers}
          onClose={closeDialog}
          onSubmit={(name, icon, hiddenFromUsers) => {
            changeBlock(dialog.block.id, { name, icon, hiddenFromUsers });
            closeDialog();
          }}
        />
      )}

      {dialog?.kind === 'delete-block' && (
        <ConfirmDialog
          title="删除区域块"
          description={
            dialog.block.devices.length > 0
              ? `将删除「${dialog.block.name}」及其中的 ${dialog.block.devices.length} 个设备,此操作无法撤销。`
              : `将删除空区域块「${dialog.block.name}」,此操作无法撤销。`
          }
          confirmLabel="删除"
          onConfirm={() => {
            deleteBlock(dialog.block.id);
            closeDialog();
          }}
          onClose={closeDialog}
        />
      )}

      {dialog?.kind === 'edit-device' && (
        <DeviceEditDialog
          entityId={dialog.device.entity_id}
          initialName={dialog.device.name}
          initialIcon={dialog.device.icon}
          initialHiddenFromUsers={dialog.device.hiddenFromUsers}
          onClose={closeDialog}
          onSubmit={(name, icon, hiddenFromUsers) => {
            changeDevice(dialog.blockId, dialog.device.entity_id, { name, icon, hiddenFromUsers });
            closeDialog();
          }}
        />
      )}

      <Suspense fallback={null}>
        {dialog?.kind === 'device-logs' && (
          <DeviceLogsDialog
            entityId={dialog.device.entity_id}
            deviceName={dialog.device.name ?? dialog.device.entity_id}
            onClose={closeDialog}
          />
        )}

        {dialog?.kind === 'picker' && (
          <DevicePickerDialog block={dialog.block} onClose={closeDialog} />
        )}
      </Suspense>
    </>
  );
}
