/**
 * 设备编辑弹窗:设置/清除单个设备的自定义名与自定义图标。
 * 名称留空 → 恢复跟随 HA 的 friendly_name;图标选「自动」 → 恢复按类型/属性自动选择。
 */
import { useState } from 'react';
import type { IconName } from '../icons';
import { Icon } from '../icons';
import { useEntityState } from '../ha/useEntityState';
import { Dialog } from './ui/Dialog';

/** 设备可选图标(自动 = 跟随卡片默认逻辑) */
const ICON_CHOICES: IconName[] = [
  'air-conditioner',
  'thermometer',
  'leaf',
  'droplets',
  'flame',
  'snowflake',
  'fan',
  'sun',
  'moon',
  'power',
  'curtain',
  'window',
  'door',
  'monitor',
  'sofa',
  'bed',
  'cooking-pot',
  'bathtub',
  'wifi',
];

interface DeviceEditDialogProps {
  /** 设备实体 ID */
  entityId: string;
  /** 当前自定义名(未设置则为 undefined) */
  initialName?: string;
  /** 当前自定义图标(未设置则为 undefined,即「自动」) */
  initialIcon?: string;
  initialHiddenFromUsers?: boolean;
  /** 提交自定义项;name 传空字符串清除名称,icon 传 undefined 恢复自动 */
  onSubmit: (name: string, icon: string | undefined, hiddenFromUsers: boolean) => void;
  onClose: () => void;
}

export function DeviceEditDialog({
  entityId,
  initialName = '',
  initialIcon,
  initialHiddenFromUsers = false,
  onSubmit,
  onClose,
}: DeviceEditDialogProps) {
  const entity = useEntityState(entityId);
  const haName = (entity?.attributes?.friendly_name as string | undefined) ?? entityId;
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | undefined>(initialIcon);
  const [hiddenFromUsers, setHiddenFromUsers] = useState(initialHiddenFromUsers);

  const submit = () => onSubmit(name.trim(), icon, hiddenFromUsers);

  return (
    <Dialog
      title="编辑设备"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={submit}>
            保存
          </button>
        </>
      }
    >
      <div className="zone-form">
        <div className="field">
          <label htmlFor="device-name-input">显示名称</label>
          <input
            id="device-name-input"
            value={name}
            autoFocus
            placeholder={haName}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <p className="field__hint">留空则跟随 Home Assistant 名称(当前:{haName})</p>
        </div>
        <label className="visibility-toggle"><input type="checkbox" checked={hiddenFromUsers} onChange={(e) => setHiddenFromUsers(e.target.checked)} />仅管理员可见<span>普通用户页面将隐藏此设备</span></label>
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
              <span className="icon-grid__none">自动</span>
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
          <p className="field__hint">「自动」按设备类型与属性选择图标(如 CO₂ 显示绿叶)</p>
        </div>
      </div>
    </Dialog>
  );
}
