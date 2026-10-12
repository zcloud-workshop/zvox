import { useEffect, useId, useRef, type ReactNode } from 'react'

export function ConfirmDialog({
  title,
  children,
  busy,
  onClose,
  onConfirm,
}: {
  title: string
  children: ReactNode
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="dialog-content">{children}</div>
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? '正在处理...' : '确认操作'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
