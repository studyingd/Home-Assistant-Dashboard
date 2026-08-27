import { Icon, type IconName } from '../../icons';

export interface PillOption {
  value: string;
  label: string;
  icon?: IconName;
  /** 选中时的颜色与背景(CSS 变量值) */
  color?: string;
  background?: string;
}

interface PillSelectorProps {
  options: PillOption[];
  value: string | null;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

/** 胶囊单选行(用于空调模式、风速等) */
export function PillSelector({ options, value, onSelect, disabled = false }: PillSelectorProps) {
  return (
    <div className="pill-row" role="radiogroup">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`pill${active ? ' active' : ''}`}
            style={
              active && opt.color
                ? ({
                    '--pill-color': opt.color,
                    '--pill-bg': opt.background ?? 'transparent',
                  } as React.CSSProperties)
                : undefined
            }
            disabled={disabled}
            onClick={() => onSelect(opt.value)}
          >
            {opt.icon && <Icon name={opt.icon} size={13} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
