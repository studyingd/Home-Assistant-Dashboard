/**
 * 通用「名称 + 图标」弹窗:一级区域与二级区域块的新建/编辑共用
 */
import { useState } from 'react';
import type { IconName } from '../icons';
import { Icon } from '../icons';
import { Dialog } from './ui/Dialog';

const ICON_CHOICES: IconName[] = [
  'folder',
  'building',
  'home',
  'sofa',
  'bed',
  'cooking-pot',
  'bathtub',
  'door',
  'monitor',
  'leaf',
  'fan',
  'thermometer',
];

interface NameIconDialogProps {
  /** 弹窗标题,如 新建区域 / 编辑区域块 */
  title: string;
  /** 名称输入框占位 */
  namePlaceholder?: string;
  /** 提交按钮文案,如 创建 / 保存 */
  submitLabel: string;
  /** 是否显示图标选择;区域不显示图标,传 false(区域块默认显示) */
  withIcon?: boolean;
  initialName?: string;
  initialIcon?: string;
  initialHiddenFromUsers?: boolean;
  onSubmit: (name: string, icon: string | undefined, hiddenFromUsers: boolean) => void;
  onClose: () => void;
}

export function NameIconDialog({
  title,
  namePlaceholder,
  submitLabel,
  withIcon = true,
  initialName = '',
  initialIcon,
  initialHiddenFromUsers = false,
  onSubmit,
  onClose,
}: NameIconDialogProps) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | undefined>(initialIcon);
  const [hiddenFromUsers, setHiddenFromUsers] = useState(initialHiddenFromUsers);
  const valid = name.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    onSubmit(name.trim(), withIcon ? icon : undefined, hiddenFromUsers);
  };

  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" disabled={!valid} onClick={submit}>
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="zone-form">
        <div className="field">
          <label htmlFor="name-icon-name">名称</label>
          <input
            id="name-icon-name"
            value={name}
            autoFocus
            placeholder={namePlaceholder}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </div>
        {withIcon && (
          <div className="field">
            <label>图标</label>
            <div className="icon-grid" role="radiogroup" aria-label="图标">
              <button
                type="button"
                role="radio"
                aria-checked={icon === undefined}
                className={`icon-grid__cell${icon === undefined ? ' active' : ''}`}
                onClick={() => setIcon(undefined)}
              >
                <span className="icon-grid__none">无</span>
              </button>
              {ICON_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={icon === choice}
                  className={`icon-grid__cell${icon === choice ? ' active' : ''}`}
                  aria-label={choice}
                  title={choice}
                  onClick={() => setIcon(choice)}
                >
                  <Icon name={choice} size={20} />
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="visibility-toggle"><input type="checkbox" checked={hiddenFromUsers} onChange={(e) => setHiddenFromUsers(e.target.checked)} />仅管理员可见<span>普通用户页面将隐藏此内容</span></label>
      </div>
    </Dialog>
  );
}
