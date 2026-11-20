import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { DotsThree, Info } from '@phosphor-icons/react';

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

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void };

/** A "⋯" button that opens a small menu of less-used actions. */
export function MenuButton({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const list = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      list[(at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      e.preventDefault();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button ref={trigger} type="button" className="icon-btn" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open} data-open={open || undefined} onClick={() => setOpen((o) => !o)}>
        <DotsThree size={18} weight="bold" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label={label}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="menu-item"
              onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
