/**
 * 一个二级区域块:块头(图标 + 名称 + 设备数)+ 该块设备网格。
 * 编辑模式下:块头可拖动排序,出现 改名/删除 按钮;设备卡可拖动排序(编辑态下卡内控件本已禁用),
 * 卡片右上角有 编辑/移除 角标,网格末尾有「+ 添加设备」。
 */
import { useState } from 'react';
import type { RegionBlock } from '../lib/types';
import { useHass } from '../ha/useHass';
import { Icon } from '../icons';
import { IconButton } from './ui/IconButton';
import { SkeletonCard } from './ui/CardShell';
import { DeviceCard } from './DeviceCard';

interface BlockSectionProps {
  block: RegionBlock;
  editMode: boolean;
  readOnly?: boolean;
  onEditBlock: () => void;
  onDeleteBlock: () => void;
  onAddDevices: () => void;
  onEditDevice: (entityId: string) => void;
  onOpenDeviceLogs: (entityId: string) => void;
  onRemoveDevice: (entityId: string) => void;
  /** 拖动排序:把 dragEntityId 设备移到 targetEntityId 之前/之后(本块内) */
  onMoveDevice: (dragEntityId: string, targetEntityId: string, after: boolean) => void;
  /** 编辑模式下拖动块头排序(由 RegionView 提供) */
  onHeadDragStart?: (e: React.DragEvent<HTMLElement>) => void;
  onHeadDragEnd?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function BlockSection({
  block,
  editMode,
  readOnly = false,
  onEditBlock,
  onDeleteBlock,
  onAddDevices,
  onEditDevice,
  onOpenDeviceLogs,
  onRemoveDevice,
  onMoveDevice,
  onHeadDragStart,
  onHeadDragEnd,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
}: BlockSectionProps) {
  const { states } = useHass();
  const visibleDevices = readOnly ? block.devices.filter((device) => !device.hiddenFromUsers) : block.devices;
  const count = visibleDevices.length;

  // 设备拖动排序:被拖设备 entity_id + 当前悬停目标(含落在其前/后)。
  // 状态留在本块内,因此设备只能在本块内重排(跨块拖动自然不响应)。
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const resetDrag = () => {
    setDragId(null);
    setOver(null);
  };

  return (
    <section className="block-section">
      <header
        className="block-section__head"
        draggable={editMode}
        onDragStart={onHeadDragStart}
        onDragEnd={onHeadDragEnd}
        title={editMode ? '拖动可调整区域块顺序' : undefined}
      >
        {editMode && (
          <span className="drag-handle" aria-hidden="true">
            <Icon name="grip-vertical" size={16} />
          </span>
        )}
        {block.icon && (
          <span className="block-section__icon">
            <Icon name={block.icon} size={16} />
          </span>
        )}
        <h2 className="block-section__title">{block.name}</h2>
        {block.hiddenFromUsers && !readOnly && <Icon name="lock" size={13} />}
        <span className="block-section__meta">
          {count} 个设备
        </span>
        {editMode && (
          <span className="block-section__actions">
            <IconButton icon="arrow-up" label={`上移区域块「${block.name}」`} size={15} className="sm" disabled={!canMoveUp} onClick={onMoveUp} />
            <IconButton icon="arrow-down" label={`下移区域块「${block.name}」`} size={15} className="sm" disabled={!canMoveDown} onClick={onMoveDown} />
            <IconButton
              icon="pencil"
              label={`编辑区域块「${block.name}」`}
              size={15}
              className="sm"
              onClick={onEditBlock}
            />
            <IconButton
              icon="trash"
              label={`删除区域块「${block.name}」`}
              size={15}
              className="sm"
              danger
              onClick={onDeleteBlock}
            />
          </span>
        )}
      </header>

      {count > 0 || editMode ? (
        <div
          className={`card-grid${editMode ? ' editing' : ''}`}
          onDragLeave={(e) => {
            // 拖出整个网格时清除指示线(在卡片间移动不清除)
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
          }}
        >
          {states === null
            ? visibleDevices.map((device) => <SkeletonCard key={device.entity_id} />)
              : visibleDevices.map((device, deviceIndex) => {
                const previous = visibleDevices[deviceIndex - 1];
                const next = visibleDevices[deviceIndex + 1];
                const dropSide =
                  over?.id === device.entity_id ? (over.after ? ' drop-after' : ' drop-before') : '';
                return (
                  <div
                    className={`card-wrap${dragId === device.entity_id ? ' dragging' : ''}${dropSide}${!readOnly && !editMode ? ' is-loggable' : ''}`}
                    role={!readOnly && !editMode ? 'group' : undefined}
                    tabIndex={!readOnly && !editMode ? 0 : undefined}
                    aria-label={!readOnly && !editMode ? `查看设备 ${device.name ?? device.entity_id} 的操作日志` : undefined}
                    onClick={!readOnly && !editMode ? (event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
                      onOpenDeviceLogs(device.entity_id);
                    } : undefined}
                    onKeyDown={!readOnly && !editMode ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      const target = event.target as HTMLElement;
                      if (target.closest('button, input, select, textarea, a, [role="button"]')) return;
                      event.preventDefault();
                      onOpenDeviceLogs(device.entity_id);
                    } : undefined}
                    key={device.entity_id}
                    draggable={editMode}
                    onDragStart={
                      editMode
                        ? (e) => {
                            setDragId(device.entity_id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', device.entity_id);
                          }
                        : undefined
                    }
                    onDragOver={
                      editMode
                        ? (e) => {
                            if (!dragId) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                            const r = e.currentTarget.getBoundingClientRect();
                            setOver({ id: device.entity_id, after: e.clientX > r.left + r.width / 2 });
                          }
                        : undefined
                    }
                    onDrop={
                      editMode
                        ? (e) => {
                            e.preventDefault();
                            if (dragId && dragId !== device.entity_id) {
                              const r = e.currentTarget.getBoundingClientRect();
                              onMoveDevice(dragId, device.entity_id, e.clientX > r.left + r.width / 2);
                            }
                            resetDrag();
                          }
                        : undefined
                    }
                    onDragEnd={editMode ? resetDrag : undefined}
                  >
                    <DeviceCard config={device} />
                    {device.hiddenFromUsers && !readOnly && <span className="device-visibility-badge" title="仅管理员可见"><Icon name="lock" size={12} /></span>}
                    {editMode && (
                      <div className="corner-badges">
                        <IconButton icon="arrow-up" label={`上移设备 ${device.name ?? device.entity_id}`} size={15} className="sm" disabled={!previous} onClick={() => previous && onMoveDevice(device.entity_id, previous.entity_id, false)} />
                        <IconButton icon="arrow-down" label={`下移设备 ${device.name ?? device.entity_id}`} size={15} className="sm" disabled={!next} onClick={() => next && onMoveDevice(device.entity_id, next.entity_id, true)} />
                        <IconButton
                          icon="pencil"
                          label={`编辑设备 ${device.name ?? device.entity_id}`}
                          size={15}
                          className="sm"
                          onClick={() => onEditDevice(device.entity_id)}
                        />
                        <IconButton
                          icon="trash"
                          label={`移除设备 ${device.name ?? device.entity_id}`}
                          size={15}
                          className="sm"
                          danger
                          onClick={() => onRemoveDevice(device.entity_id)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          {editMode && (
            <button type="button" className="card add-device-card" onClick={onAddDevices}>
              <Icon name="plus" size={22} />
              <span>添加设备</span>
            </button>
          )}
        </div>
      ) : (
        <p className="block-section__empty">{readOnly ? '此区域块暂无可见设备' : '此区域块还没有设备,进入编辑模式添加'}</p>
      )}
    </section>
  );
}
