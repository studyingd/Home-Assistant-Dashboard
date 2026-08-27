/**
 * 顶部一级区域标签条:点按切换区域;编辑模式下当前标签旁出现 改名/删除 角标,
 * 末尾有「+ 新建区域」幽灵标签;编辑模式下可拖动标签排序(插入位置以指示线提示)。
 */
import { useEffect, useRef, useState } from 'react';
import type { Region } from '../lib/types';
import { Icon } from '../icons';

interface RegionNavProps {
  regions: Region[];
  activeRegionId: string | null;
  editMode: boolean;
  onSelectRegion: (id: string) => void;
  onCreateRegion: () => void;
  onEditRegion: (region: Region) => void;
  onDeleteRegion: (region: Region) => void;
  /** 拖动排序:把 dragId 移到 targetId 之前/之后 */
  onMoveRegion: (dragId: string, targetId: string, after: boolean) => void;
}

export function RegionNav({
  regions,
  activeRegionId,
  editMode,
  onSelectRegion,
  onCreateRegion,
  onEditRegion,
  onDeleteRegion,
  onMoveRegion,
}: RegionNavProps) {
  const navRef = useRef<HTMLElement>(null);
  // 拖动排序:被拖区域 id + 当前悬停目标(含落在其前/后)
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const resetDrag = () => {
    setDragId(null);
    setOver(null);
  };

  // 激活区域变化时,把对应标签滚动进可视区
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector('.region-tab.active');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeRegionId, regions.length]);

  return (
    <nav className="region-nav" aria-label="区域" ref={navRef}>
      {/* 标签在独立容器内横向滚动;「新建区域」按钮在滚动区之外,始终可见可点 */}
      <div
        className="region-nav__tabs"
        onDragLeave={(e) => {
          // 拖出整个标签条时清除指示线(在子标签间移动不清除)
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
        }}
      >
        {regions.map((region) => {
          const active = region.id === activeRegionId;
          const dropSide = over?.id === region.id ? (over.after ? ' drop-after' : ' drop-before') : '';
          return (
            <div
              className={`region-tab${active ? ' active' : ''}${dragId === region.id ? ' dragging' : ''}${dropSide}`}
              key={region.id}
              draggable={editMode}
              onDragStart={
                editMode
                  ? (e) => {
                      setDragId(region.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', region.id);
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
                      setOver({ id: region.id, after: e.clientX > r.left + r.width / 2 });
                    }
                  : undefined
              }
              onDrop={
                editMode
                  ? (e) => {
                      e.preventDefault();
                      if (dragId && dragId !== region.id) {
                        const r = e.currentTarget.getBoundingClientRect();
                        onMoveRegion(dragId, region.id, e.clientX > r.left + r.width / 2);
                      }
                      resetDrag();
                    }
                  : undefined
              }
              onDragEnd={editMode ? resetDrag : undefined}
            >
              <button
                type="button"
                className="region-tab__main"
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelectRegion(region.id)}
              >
                <span className="region-tab__name">{region.name}{region.hiddenFromUsers && editMode && <Icon name="lock" size={12} />}</span>
              </button>
              {editMode && active && (
                <span className="region-tab__actions">
                  <button
                    type="button"
                    className="region-tab__action"
                    aria-label={`编辑区域「${region.name}」`}
                    title={`编辑区域「${region.name}」`}
                    onClick={() => onEditRegion(region)}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  <button
                    type="button"
                    className="region-tab__action danger"
                    aria-label={`删除区域「${region.name}」`}
                    title={`删除区域「${region.name}」`}
                    onClick={() => onDeleteRegion(region)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>
      {editMode && (
        <button type="button" className="region-tab add" onClick={onCreateRegion}>
          <Icon name="plus" size={15} />
          <span>新建区域</span>
        </button>
      )}
    </nav>
  );
}
