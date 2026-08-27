import { useRef, useState, type KeyboardEvent } from 'react';

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  /** 外部真实值 */
  value: number;
  /** 拖动过程中仅更新本地草稿;松手/键盘结束/失焦时提交一次 */
  onCommit: (value: number) => void;
  disabled?: boolean;
  fillPercent?: number;
  'aria-label'?: string;
}

/** 提交时机为「释放」的滑杆,避免拖动过程中高频调用 */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onCommit,
  disabled = false,
  fillPercent,
  'aria-label': ariaLabel,
}: SliderProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  draftRef.current = draft;

  const shown = draft ?? value;
  const fill = fillPercent ?? ((shown - min) / (max - min)) * 100;

  const commitDraft = () => {
    const current = draftRef.current;
    if (current === null) return;
    setDraft(null);
    if (current !== value) onCommit(current);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 键盘调整结束时提交(松开按键)
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) && draftRef.current !== null) {
      commitDraft();
    }
  };

  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={shown}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ '--fill': `${fill}%` } as React.CSSProperties}
      onChange={(e) => setDraft(Number(e.target.value))}
      onPointerUp={commitDraft}
      onTouchEnd={commitDraft}
      onKeyUp={handleKeyDown}
      onBlur={commitDraft}
    />
  );
}
