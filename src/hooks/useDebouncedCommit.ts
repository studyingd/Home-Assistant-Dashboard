import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 「草稿值 + 防抖提交」模式:
 * UI 先更新本地 draft,停止操作 delay 毫秒后才真正提交一次,
 * 避免连续点击/拖动时产生大量 service 调用。
 *
 * 返回 [draft, setDraft];setDraft(null) 表示放弃草稿、清除计时器。
 */
export function useDebouncedCommit<T>(
  commit: (value: T) => void,
  delay = 500,
): [T | null, (value: T | null) => void] {
  const [draft, setDraftState] = useState<T | null>(null);
  const timerRef = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const setDraft = useCallback(
    (value: T | null) => {
      setDraftState(value);
      clearTimer();
      if (value === null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        commitRef.current(value);
        setDraftState(null);
      }, delay);
    },
    [delay],
  );

  useEffect(() => clearTimer, []);

  return [draft, setDraft];
}
