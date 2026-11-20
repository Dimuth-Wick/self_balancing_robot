import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Info } from '@phosphor-icons/react';

// Small accessible controls in the dashboard's look (geometry from the
// stageshow kit: 26px segments on a 2px track, 30×18 switch, 28px buttons).

export function Segmented<T extends string | number>({ label, options, value, onChange, size }: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'small';
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} data-size={size}
      style={{ ['--n' as string]: options.length, ['--i' as string]: index }}>
      <span className="seg-thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
          className="seg-option" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)}>
      <span className="switch-label">{label}</span>
      <span className="switch-track" data-on={on || undefined}><span className="switch-knob" /></span>
    </button>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'small' | 'large';
  icon?: ReactNode;
};

export function Button({ variant = 'default', size, icon, children, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest} className={`btn${className ? ` ${className}` : ''}`}
      data-variant={variant} data-size={size} data-leading={icon ? true : undefined}>
      {icon}
      {children !== undefined && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" {...rest} className={`icon-btn${className ? ` ${className}` : ''}`} aria-label={label} title={label}>
      {children}
    </button>
  );
}

/** An info mark that explains a term on hover and to screen readers. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} role="img" aria-label={text} title={text}>
      <Info size={14} weight="fill" />
    </span>
  );
}
