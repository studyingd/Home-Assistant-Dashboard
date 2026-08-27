import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../../icons';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  size?: number;
  active?: boolean;
  danger?: boolean;
}

/** 带无障碍标签的图标按钮 */
export function IconButton({
  icon,
  label,
  size = 19,
  active = false,
  danger = false,
  className = '',
  ...rest
}: IconButtonProps) {
  const classes = ['icon-btn', active ? 'active' : '', danger ? 'danger' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={classes} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}
