import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CheckCheck, Dumbbell, Flag, Info, LoaderCircle, X } from 'lucide-react';

export function Brand() {
  return <span className="brand"><span className="brand-mark"><CheckCheck size={23} strokeWidth={3} aria-hidden="true" /></span><span>show up<span className="brand-period">.</span></span></span>;
}
export function CategoryIcon({ category, small = false }) {
  const Icon = category === 'Fitness' ? Dumbbell : category === 'Study' ? BookOpen : Flag;
  return <span className={'category-icon ' + category.toLowerCase() + (small ? ' small' : '')}><Icon size={small ? 16 : 21} strokeWidth={1.9} aria-hidden="true" /></span>;
}
export function IconButton({ title, children, ...props }) {
  return <button type="button" className="icon-button" title={title} aria-label={title} {...props}>{children}</button>;
}
export function SectionTitle({ children, action }) {
  return <div className="section-heading"><h2>{children}</h2>{action}</div>;
}
export function Button({ children, kind = 'primary', icon, right, busy, disabled, className = '', type = 'button', ...props }) {
  return <button type={type} className={'button ' + kind + ' ' + className} disabled={disabled || busy} {...props}>
    {busy ? <LoaderCircle className="spinner" size={17} aria-hidden="true" /> : icon}{children}{right}
  </button>;
}
export function Empty({ icon: Icon = Flag, title, children, action }) {
  return <div className="empty"><Icon size={24} aria-hidden="true" /><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function PageTitle({ label, title, children, action }) {
  return <header className="page-title"><div>{label && <div className="eyebrow">{label}</div>}<h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</header>;
}
export function Avatar({ name, initials, size = '', secondary = false }) {
  return <span title={name} className={'avatar ' + size + (secondary ? ' secondary' : '')}>{initials}</span>;
}
export function ErrorNote({ error }) {
  return error ? <p className="error-note" role="alert">{error}</p> : null;
}
export function Credit() {
  return <footer className="credit">made by anvi karanjkar</footer>;
}
export function FieldHelp({ label, children }) {
  const id = useId();
  const ref = useRef(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = (hover || focus || pinned) && !dismissed;
  useEffect(() => {
    if (!shown) return;
    if (matchMedia('(pointer: coarse)').matches) {
      ref.current?.querySelector('[role="tooltip"]')?.scrollIntoView({ block: 'nearest' });
    }
    const hide = () => { setDismissed(true); setPinned(false); };
    const outside = event => { if (!ref.current?.contains(event.target)) hide(); };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [shown]);
  return <span className="field-help" ref={ref}
    onPointerEnter={event => {
      if (event.pointerType === 'mouse') { setHover(true); setDismissed(false); }
    }} onPointerLeave={() => setHover(false)}>
    <button type="button" className="help-trigger" aria-label={'About ' + label} aria-describedby={id}
      aria-expanded={shown} aria-controls={id}
      onFocus={event => {
        if (event.currentTarget.matches(':focus-visible')) { setFocus(true); setDismissed(false); }
      }} onBlur={() => setFocus(false)}
      onClick={() => { setDismissed(pinned); setPinned(!pinned); }}><Info size={15} aria-hidden="true" /></button>
    <span className="help-bubble" role="tooltip" id={id} hidden={!shown}>{children}</span>
  </span>;
}
export function Modal({ title, label, children, close, sheet = false, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  const dismiss = useRef(close);
  dismiss.current = close;
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const input = dialog.querySelector('[data-first]');
    if (input && !matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={'modal' + (sheet ? ' sheet' : '') + (wide ? ' wide' : '')} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); dismiss.current(); }}
    onClick={event => { if (event.target === ref.current) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dismiss.current(); } }}>
    <header className="modal-head"><div>{label && <div className="eyebrow">{label}</div>}<h2 id={titleId}>{title}</h2></div><IconButton title="Close dialog" onClick={close}><X size={20} /></IconButton></header>
    {children}
  </dialog>;
}
export function Forward({ children, onClick }) {
  return <button className="text-button" type="button" onClick={onClick}>{children}<ArrowRight size={16} aria-hidden="true" /></button>;
}
