/**
 * 当前区域视图:把该区域的所有区域块纵向平铺在同一界面。
 * region 为 null 表示还没有任何区域(显示创建入口)。
 * 编辑模式下可拖动块头排序(插入位置以指示线提示)。
 */
import { useState } from 'react';
import type { Region, RegionBlock } from '../lib/types';
import { Icon } from '../icons';
import { BlockSection } from './BlockSection';

interface RegionViewProps {
  region: Region | null;
  editMode: boolean;
  readOnly?: boolean;
  onCreateRegion: () => void;
  onCreateBlock: () => void;
  onEditBlock: (block: RegionBlock) => void;
  onDeleteBlock: (block: RegionBlock) => void;
  onAddDevices: (block: RegionBlock) => void;
  onEditDevice: (block: RegionBlock, entityId: string) => void;
  onOpenDeviceLogs: (device: RegionBlock['devices'][number]) => void;
  onRemoveDevice: (blockId: string, entityId: string) => void;
  /** 拖动排序:在当前区域内把 dragId 块移到 targetId 之前/之后 */
  onMoveBlock: (regionId: string, dragId: string, targetId: string, after: boolean) => void;
  /** 拖动排序:在 blockId 内把 dragEntityId 设备移到 targetEntityId 之前/之后 */
  onMoveDevice: (blockId: string, dragEntityId: string, targetEntityId: string, after: boolean) => void;
}

export function RegionView({
  region,
  editMode,
  readOnly = false,
  onCreateRegion,
  onCreateBlock,
  onEditBlock,
  onDeleteBlock,
  onAddDevices,
  onEditDevice,
  onOpenDeviceLogs,
  onRemoveDevice,
  onMoveBlock,
  onMoveDevice,
}: RegionViewProps) {
  // 拖动排序:被拖块 id + 当前悬停目标(含落在其前/后)
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const resetDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const visibleBlocks = readOnly ? region?.blocks.filter((block) => !block.hiddenFromUsers) ?? [] : region?.blocks ?? [];

  // 还没有任何区域
  if (!region) {
    return (
      <div className="empty-hint">
        <p>{readOnly ? '暂无可见区域' : '还没有任何区域'}</p>
        {!readOnly && <button type="button" className="btn primary" onClick={onCreateRegion}>
          <Icon name="plus" size={16} />
          创建第一个区域
        </button>}
      </div>
    );
  }

  return (
    <div
      className="region-view"
      onDragLeave={(e) => {
        // 拖出整个列表时清除指示线(在块之间移动不清除)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
      }}
    >
      {visibleBlocks.map((block, blockIndex) => {
        const previous = visibleBlocks[blockIndex - 1];
        const next = visibleBlocks[blockIndex + 1];
        const dropSide = over?.id === block.id ? (over.after ? ' drop-after' : ' drop-before') : '';
        return (
          <div
            key={block.id}
            className={`block-reorder${dragId === block.id ? ' dragging' : ''}${dropSide}`}
            onDragOver={
              editMode
                ? (e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const r = e.currentTarget.getBoundingClientRect();
                    setOver({ id: block.id, after: e.clientY > r.top + r.height / 2 });
                  }
                : undefined
            }
            onDrop={
              editMode
                ? (e) => {
                    e.preventDefault();
                    if (dragId && dragId !== block.id) {
                      const r = e.currentTarget.getBoundingClientRect();
                      onMoveBlock(region.id, dragId, block.id, e.clientY > r.top + r.height / 2);
                    }
                    resetDrag();
                  }
                : undefined
            }
          >
            <BlockSection
              block={block}
              editMode={editMode}
              readOnly={readOnly}
              onEditBlock={() => onEditBlock(block)}
              onDeleteBlock={() => onDeleteBlock(block)}
              onAddDevices={() => onAddDevices(block)}
              onEditDevice={(entityId) => onEditDevice(block, entityId)}
              onOpenDeviceLogs={(entityId) => {
                const device = block.devices.find((item) => item.entity_id === entityId);
                if (device) onOpenDeviceLogs(device);
              }}
              onRemoveDevice={(entityId) => onRemoveDevice(block.id, entityId)}
              onMoveDevice={(dragEntityId, targetEntityId, after) =>
                onMoveDevice(block.id, dragEntityId, targetEntityId, after)
              }
              onHeadDragStart={
                editMode
                  ? (e) => {
                      setDragId(block.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', block.id);
                    }
                  : undefined
              }
              onHeadDragEnd={editMode ? resetDrag : undefined}
              canMoveUp={Boolean(previous)}
              canMoveDown={Boolean(next)}
              onMoveUp={() => previous && onMoveBlock(region.id, block.id, previous.id, false)}
              onMoveDown={() => next && onMoveBlock(region.id, block.id, next.id, true)}
            />
          </div>
        );
      })}

      {editMode && (
        <button type="button" className="add-block" onClick={onCreateBlock}>
          <Icon name="plus" size={18} />
          <span>新建区域块</span>
        </button>
      )}

      {!editMode && visibleBlocks.length === 0 && (
        <div className="empty-hint">
          <p>{readOnly ? '此区域暂无可见区域块' : '此区域还没有区域块,进入编辑模式添加'}</p>
        </div>
      )}
    </div>
  );
}
