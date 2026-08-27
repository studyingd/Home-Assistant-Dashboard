/**
 * 通用弹窗外壳:仅通过右上角 X 按钮(或弹窗自带的操作按钮)关闭。
 * 点击遮罩、按 Esc 都不关闭,避免误触丢失未保存的输入。
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from './IconButton';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 底部操作区 */
  actions?: ReactNode;
  /** 宽弹窗(设备选择器等) */
  wide?: boolean;
  /** 业务弹窗的附加样式类 */
  className?: string;
}

export function Dialog({ title, onClose, children, actions, wide, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, []);
  return (
    <div className="dialog-overlay">
      <div ref={dialogRef} className={`dialog${wide ? ' dialog--wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog__header">
          <h2 className="dialog__title">{title}</h2>
          <IconButton icon="x" label="关闭" onClick={onClose} />
        </div>
        {children}
        {actions && <div className="dialog__actions">{actions}</div>}
      </div>
    </div>
  );
}
