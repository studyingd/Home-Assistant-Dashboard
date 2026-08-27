/**
 * 危险操作确认弹窗(删除分区等)
 */
import { Dialog } from './ui/Dialog';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-desc">{description}</p>
    </Dialog>
  );
}
