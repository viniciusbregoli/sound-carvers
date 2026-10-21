import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Visually hide the title (it still names the dialog). */
  hideTitle?: boolean;
  variant?: 'center' | 'sheet';
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** Native <dialog>: focus trap, Escape and inert background come from the platform. */
export function Dialog({ open, onClose, title, hideTitle, variant = 'center', className = '', children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant} ${className}`}
      aria-labelledby={titleId}
      onClose={(e) => {
        // React propagates these through nested dialogs; only react to our own.
        if (e.target === e.currentTarget) onClose();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Click on the backdrop (the dialog element itself, outside its panel) closes it.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="dialog-panel">
          <header className="dialog-header">
            <h2 id={titleId} className={hideTitle ? 'visually-hidden' : 'dialog-title'}>
              {title}
            </h2>
            <button className="icon-btn dialog-close" aria-label="Fechar" onClick={onClose}>
              <X size={20} aria-hidden />
            </button>
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

type ConfirmProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onClose }: ConfirmProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      className="dialog-confirm"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} autoFocus>
            Cancelar
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
    </Dialog>
  );
}
