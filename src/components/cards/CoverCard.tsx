import { memo, useEffect, useState } from 'react';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { DeviceConfig } from '../../lib/types';
import { useHass } from '../../ha/useHass';
import { CardShell } from '../ui/CardShell';
import { IconButton } from '../ui/IconButton';
import { Slider } from '../ui/Slider';
import './CoverCard.css';

// cover 域 supported_features 位掩码
const SUPPORT_OPEN = 1;
const SUPPORT_CLOSE = 2;
const SUPPORT_SET_POSITION = 4;
const SUPPORT_STOP = 8;

// 打开中/关闭中是瞬态状态:超过该时长仍未变化,说明设备已失联
// (集成未把状态翻成 unavailable 而是冻结在瞬态,如利旧开窗器掉线时),按离线处理
const TRANSIENT_STALE_MS = 5 * 60_000;

const STATE_LABELS: Record<string, string> = {
  open: '已打开',
  closed: '已关闭',
  opening: '打开中…',
  closing: '关闭中…',
};

interface CoverCardProps {
  config: DeviceConfig;
  entity: HassEntity;
}

export const CoverCard = memo(function CoverCard({ config, entity }: CoverCardProps) {
  const { callService } = useHass();
  const entityId = entity.entity_id;
  const attrs = entity.attributes as Record<string, unknown>;
  const variant = config.coverVariant ?? 'curtain';

  // 瞬态状态僵死检测:打开中/关闭中长时间无更新 → 设备失联,按离线处理
  const lastChangedMs = entity.last_changed ? Date.parse(entity.last_changed) : Number.NaN;
  const transientStuck =
    !Number.isNaN(lastChangedMs)
    && (entity.state === 'opening' || entity.state === 'closing')
    && Date.now() - lastChangedMs > TRANSIENT_STALE_MS;
  // 状态冻结时实体不会推送更新,靠本地定时器驱动重渲染以进入僵死判定
  const [, setStaleTick] = useState(0);
  useEffect(() => {
    if (entity.state !== 'opening' && entity.state !== 'closing') return undefined;
    const timer = window.setInterval(() => setStaleTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [entity.state]);

  const unavailable = entity.state === 'unavailable' || entity.state === 'unknown' || transientStuck;
  const name = config.name ?? (attrs.friendly_name as string) ?? entityId;
  const features = typeof attrs.supported_features === 'number' ? attrs.supported_features : 0;

  const supportsOpen = (features & SUPPORT_OPEN) !== 0 || features === 0;
  const supportsClose = (features & SUPPORT_CLOSE) !== 0 || features === 0;
  const supportsStop = (features & SUPPORT_STOP) !== 0;
  const supportsPosition = (features & SUPPORT_SET_POSITION) !== 0;

  const rawPosition =
    typeof attrs.current_position === 'number' ? attrs.current_position : null;
  // 无位置属性时按状态推断
  const position =
    rawPosition ?? (entity.state === 'open' ? 100 : entity.state === 'closed' ? 0 : null);

  const stateLabel = transientStuck
    ? `${entity.state === 'opening' ? '打开中' : '关闭中'}·无响应`
    : STATE_LABELS[entity.state] ?? entity.state;
  const [pendingState, setPendingState] = useState<string | null>(null);
  const shownState = pendingState ?? entity.state;
  const shownMoving = shownState === 'opening' || shownState === 'closing';
  const shownOpenLike = shownState === 'open' || shownState === 'opening';
  useEffect(() => {
    if (!pendingState) return undefined;
    if (entity.state === pendingState || (pendingState === 'opening' && entity.state === 'open') || (pendingState === 'closing' && entity.state === 'closed')) {
      setPendingState(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setPendingState(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [entity.state, pendingState]);

  const call = (service: string, data?: Record<string, unknown>) => {
    const optimistic = service === 'open_cover' ? 'opening' : service === 'close_cover' ? 'closing' : null;
    if (optimistic) setPendingState(optimistic);
    callService('cover', service, { entity_id: entityId, ...data }).catch((err) => { setPendingState(null); console.warn(`[ha-dashboard] cover.${service} 失败:`, err); });
  };

  return (
    <CardShell
      name={name}
      icon={config.icon ?? (variant === 'window' ? 'window' : 'curtain')}
      iconOn={shownOpenLike && !unavailable}
      unavailable={unavailable}
      trailing={
        <span className="chip">
          {pendingState ? STATE_LABELS[pendingState] ?? pendingState : stateLabel}
          {position !== null && !shownMoving && ` · ${Math.round(position)}%`}
        </span>
      }
    >
      <div className="cover-visual" data-variant={variant} data-state={unavailable ? 'closed' : shownState}>
        <div className="cover-visual__panel" style={{ ['--openness' as string]: `${(position ?? 0)}%` }} />
      </div>

      <div className="cover-controls">
        <IconButton
          icon="arrow-up"
          label="打开"
          disabled={unavailable || !supportsOpen}
          active={shownState === 'opening'}
          className={pendingState ? 'is-pending' : ''}
          onClick={() => call('open_cover')}
        />
        <IconButton
          icon="stop"
          label="停止"
          disabled={unavailable || !supportsStop || !shownMoving || pendingState !== null}
          onClick={() => call('stop_cover')}
        />
        <IconButton
          icon="arrow-down"
          label="关闭"
          disabled={unavailable || !supportsClose}
          active={shownState === 'closing'}
          className={pendingState ? 'is-pending' : ''}
          onClick={() => call('close_cover')}
        />
      </div>

      {supportsPosition && (
        <div className="cover-slider">
          <Slider
            min={0}
            max={100}
            step={1}
            value={position ?? 0}
            disabled={unavailable}
            aria-label={`${name}开启程度`}
            onCommit={(value) => call('set_cover_position', { position: value })}
          />
          <span className="cover-slider__value">
            {position !== null ? `${Math.round(position)}%` : '–'}
          </span>
        </div>
      )}
    </CardShell>
  );
});
