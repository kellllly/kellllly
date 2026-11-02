import { useEffect, useRef, type ReactNode } from 'react';
import { AlertTriangle, CircleHelp, Search, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function SectionTitle({ kicker, title, action }: { kicker?: string; title: string; action?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div>{kicker && <div className="eyebrow mb-1">{kicker}</div>}<h2 className="text-[16px] font-semibold tracking-[-.02em]">{title}</h2></div>{action}</div>;
}

export function Badge({ children, tone = 'neutral', testId }: { children: ReactNode; tone?: string; testId?: string }) {
  return <span data-testid={testId} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${tone === 'green' ? 'bg-[#e1efe7] text-[#28674f] dark:bg-[#214238] dark:text-[#b7dfc7]' : tone === 'amber' ? 'bg-[#f4ead5] text-[#805a20] dark:bg-[#483b25] dark:text-[#e5c78e]' : tone === 'red' ? 'bg-[#f5e2df] text-[#98483d] dark:bg-[#4c302d] dark:text-[#e7aaa1]' : tone === 'blue' ? 'bg-[#e1eaf0] text-[#3b6177] dark:bg-[#263c4a] dark:text-[#a8c8d8]' : 'bg-muted text-muted-foreground'}`}>{children}</span>;
}

export function Button({ children, onClick, variant = 'primary', type = 'button', className = '', disabled = false, testId, title }: { children: ReactNode; onClick?: () => void; variant?: string; type?: 'button' | 'submit'; className?: string; disabled?: boolean; testId?: string; title?: string }) {
  return <button type={type} title={title} data-testid={testId} onClick={onClick} disabled={disabled} className={`focus-ring inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variant === 'primary' ? 'bg-primary text-primary-foreground hover:brightness-95' : variant === 'outline' ? 'border border-border bg-card hover:bg-muted' : variant === 'quiet' ? 'text-muted-foreground hover:bg-muted hover:text-foreground' : 'bg-[#f5e3df] text-[#93463d] hover:bg-[#eed4ce] dark:bg-[#4c302d] dark:text-[#f0c1b9]'} ${className}`}>{children}</button>;
}

export function SearchBox({ value, onChange, placeholder = 'Rechercher…', testId }: { value: string; onChange: (v: string) => void; placeholder?: string; testId?: string }) {
  return <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-primary/30"><Search size={15} /><input data-testid={testId} type="search" aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/80" /></div>;
}

export function Warning() {
  return <div role="note" className="mb-5 flex items-start gap-3 rounded-xl border border-[#d8b875]/60 bg-[#f4ecd9] px-4 py-3 text-[#654e27] dark:bg-[#413720] dark:text-[#ebd8aa]"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div className="text-[11px] leading-relaxed"><strong className="font-semibold">Prototype de démonstration — non homologué.</strong> Données fictives uniquement. Ne saisissez aucune donnée personnelle réelle, information d’enquête ou information classifiée. Cette interface ne revendique ni chiffrement de bout en bout, ni certification, ni hébergement souverain, ni immutabilité de production.</div></div>;
}

export function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const restoreFocus = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : document.activeElement as HTMLElement,
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const viewport = window.visualViewport;
    if (!dialog || !viewport) return;

    const updateVisibleArea = () => {
      dialog.style.maxHeight = `${Math.max(0, Math.min(viewport.height * 0.92, viewport.height - 16))}px`;
      dialog.style.width = `${Math.max(0, viewport.width - 32)}px`;
      dialog.style.top = `${viewport.offsetTop + viewport.height / 2}px`;

      window.requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) keepFocusedFieldVisible(dialog, focused);
      });
    };

    updateVisibleArea();
    viewport.addEventListener('resize', updateVisibleArea);
    viewport.addEventListener('scroll', updateVisibleArea);
    return () => {
      viewport.removeEventListener('resize', updateVisibleArea);
      viewport.removeEventListener('scroll', updateVisibleArea);
    };
  }, []);

  return <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
    <DialogContent
      ref={dialogRef}
      aria-describedby={description ? undefined : undefined}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (restoreFocus.current?.isConnected) restoreFocus.current.focus({ preventScroll: true });
      }}
      onFocusCapture={event => {
        const focused = event.target as HTMLElement;
        const dialog = event.currentTarget;
        window.requestAnimationFrame(() => {
          keepFocusedFieldVisible(dialog, focused);
        });
      }}
      className={`max-h-[92dvh] w-[calc(100%-2rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-[14px] border-border bg-card p-5 md:p-6 ${wide ? 'max-w-[680px]' : 'max-w-[520px]'}`}
    >
      <DialogHeader className="text-left"><DialogTitle className="pr-6 text-[17px] font-semibold tracking-[-.01em]">{title}</DialogTitle><DialogDescription className={description ? 'text-[11px] leading-relaxed' : 'sr-only'}>{description ?? title}</DialogDescription></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}

function keepFocusedFieldVisible(dialog: HTMLElement, focused: HTMLElement) {
  if (!focused.isConnected || !dialog.contains(focused)) return;

  const stickyActions = dialog.querySelector<HTMLElement>('[data-dialog-sticky-actions]');
  if (stickyActions?.contains(focused)) return;

  const dialogBounds = dialog.getBoundingClientRect();
  const actionBounds = stickyActions?.getBoundingClientRect();
  const visibleTop = dialogBounds.top + 8;
  const visibleBottom = Math.min(
    dialogBounds.bottom - 8,
    actionBounds && actionBounds.top > dialogBounds.top ? actionBounds.top - 8 : dialogBounds.bottom - 8,
  );
  const focusedBounds = focused.getBoundingClientRect();
  const availableHeight = visibleBottom - visibleTop;
  const scrollDelta = focusedBounds.height > availableHeight
    ? focusedBounds.top - visibleTop
    : focusedBounds.top < visibleTop
      ? focusedBounds.top - visibleTop
      : focusedBounds.bottom > visibleBottom
        ? focusedBounds.bottom - visibleBottom
        : 0;

  if (scrollDelta) dialog.scrollTop += scrollDelta;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block text-[11px] font-semibold">{label}{children}{hint && <span className="mt-1 block text-[10px] font-normal text-muted-foreground">{hint}</span>}</label>;
}
export const inputCls = 'focus-ring mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-[12px] font-normal text-foreground';
export const textareaCls = 'focus-ring mt-1.5 w-full rounded-lg border border-border bg-card p-3 text-[12px] font-normal leading-relaxed text-foreground';

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return <div className={`grid shrink-0 place-items-center rounded-full bg-[#e8ddc7] font-bold text-[#514b3e] ${small ? 'h-7 w-7 text-[9px]' : 'h-9 w-9 text-[11px]'}`}>{name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('')}</div>;
}

export function Metric({ label, value, delta, icon: Icon, tone, testId }: { label: string; value: string; delta: string; icon: typeof ShieldCheck; tone: string; testId?: string }) {
  return <div className="panel p-4"><div className="flex items-start justify-between"><div><div className="text-[11px] text-muted-foreground">{label}</div><div data-testid={testId} className="mt-2 text-[28px] font-semibold tracking-[-.05em]">{value}</div></div><div className={`grid h-9 w-9 place-items-center rounded-lg ${tone === 'green' ? 'bg-[#e3eee7] text-[#36745a] dark:bg-[#25443a] dark:text-[#aed9c2]' : tone === 'amber' ? 'bg-[#f5ecd8] text-[#977033] dark:bg-[#483b25] dark:text-[#e5c78e]' : tone === 'red' ? 'bg-[#f5e2df] text-[#98483d] dark:bg-[#4c302d] dark:text-[#e7aaa1]' : tone === 'blue' ? 'bg-[#e4edf2] text-[#537b8d] dark:bg-[#263f4d] dark:text-[#b3cfda]' : 'bg-muted text-muted-foreground'}`}><Icon size={17} /></div></div><div className="mt-1 text-[10px] text-muted-foreground">{delta}</div></div>;
}

export function MiniStat({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return <div className="panel flex items-center gap-3 p-4"><div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-primary"><Icon size={17} /></div><div><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 text-[13px] font-semibold">{value}</div></div></div>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-border p-6 text-center"><div><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground"><CircleHelp size={17} /></div><div className="text-[12px] font-semibold">{title}</div><div className="mt-1 text-[11px] text-muted-foreground">{text}</div>{action && <div className="mt-3">{action}</div>}</div></div>;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
