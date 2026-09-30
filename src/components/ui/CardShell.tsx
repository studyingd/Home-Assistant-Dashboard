import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '../../icons';

interface CardShellProps {
  name: string;
  icon: IconName | string;
  className?: string;
  /** 图标是否处于「开启」高亮状态 */
  iconOn?: boolean;
  /** 头部右侧附加内容(芯片/按钮) */
  trailing?: ReactNode;
  /** 不可用(变灰 + 禁用交互提示) */
  unavailable?: boolean;
  children: ReactNode;
}

/** 卡片统一外壳:图标 + 名称 + 右侧槽位 + 内容 */
export function CardShell({
  name,
  icon,
  className = '',
  iconOn = false,
  trailing,
  unavailable = false,
  children,
}: CardShellProps) {
  const nameRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = nameRef.current;
    if (!element) return;

    let frame = 0;
    let lastWidth = -1;
    const fitName = (force = false) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const availableWidth = element.clientWidth;
        if (!force && Math.abs(availableWidth - lastWidth) < 0.5) return;
        lastWidth = availableWidth;
        element.style.fontSize = '';
        const baseSize = Number.parseFloat(getComputedStyle(element).fontSize);
        // 离线测量文本在指定字号下的单行宽度(复制节点避免影响布局)
        const measureWidth = (fontSize: number) => {
          const measure = element.cloneNode(true) as HTMLSpanElement;
          measure.style.position = 'fixed';
          measure.style.left = '-100000px';
          measure.style.width = 'max-content';
          measure.style.maxWidth = 'none';
          measure.style.overflow = 'visible';
          measure.style.fontSize = `${fontSize}px`;
          document.body.appendChild(measure);
          const width = measure.getBoundingClientRect().width;
          measure.remove();
          return width;
        };
        const contentWidth = measureWidth(baseSize);
        if (availableWidth <= 0 || contentWidth <= availableWidth) return;

        // 预留 6px，避免系统缩放/小数像素取整后刚好溢出；
        // 再按候选字号实测校验，仍溢出则每次降 0.25px 直到真正放下(下限 10px)
        const safeWidth = Math.max(0, availableWidth - 6);
        let fittedSize = Math.max(
          10,
          Math.floor((baseSize * safeWidth * 10) / contentWidth) / 10,
        );
        while (fittedSize > 10 && measureWidth(fittedSize) > availableWidth) {
          fittedSize = Math.max(10, fittedSize - 0.25);
        }
        element.style.fontSize = `${fittedSize}px`;
      });
    };

    fitName(true);
    const observer = new ResizeObserver(() => fitName());
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [name]);

  return (
    <div className={`card${unavailable ? ' unavailable' : ''}${className ? ` ${className}` : ''}`}>
      <div className="card__header">
        <span className={`card__icon${iconOn ? ' on' : ''}`}>
          <Icon name={icon} size={20} />
        </span>
        <span ref={nameRef} className="card__name" title={name}>
          {name}
        </span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/** 实体在 HA 中不存在时的占位卡片 */
export function NotFoundCard({ entityId }: { entityId: string }) {
  return (
    <div className="card not-found">
      <Icon name="alert-triangle" size={26} />
      <div>实体未找到</div>
      <div className="card__sub">{entityId}</div>
    </div>
  );
}

/** 首次加载数据前的骨架卡片 */
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div className="skeleton-block" style={{ width: 36, height: 36, borderRadius: 12 }} />
        <div className="skeleton-block" style={{ flex: 1, height: 16 }} />
      </div>
      <div className="skeleton-block" style={{ width: '60%', height: 36 }} />
      <div className="skeleton-block" style={{ width: '100%', height: 24 }} />
    </div>
  );
}
