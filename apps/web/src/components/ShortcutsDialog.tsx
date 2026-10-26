import { Dialog, DialogContent, DialogTitle, Kbd } from '@shotbeam/ui'
import { comboLabel, SHORTCUTS } from '../lib/hotkeys'
import { useUi } from '../lib/store'

/** Every shortcut in one place (Ctrl+/ or the keyboard button in the title bar). */
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[8%] max-w-2xl">
        <DialogTitle className="text-lg font-semibold">Горячие клавиши</DialogTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Работают в любой раскладке. В полях ввода одиночные клавиши не срабатывают.
        </p>
        <div className="mt-5 space-y-6">
          {SHORTCUTS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">{g.title}</h3>
              <ul className="divide-y">
                {g.items.map((it) => (
                  <li key={it.label} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1">{it.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {it.combos.map((c, i) => (
                        <span key={comboLabel(c)} className="flex items-center gap-1">
                          {i ? <span className="text-xs text-muted-foreground">/</span> : null}
                          <Kbd>{comboLabel(c)}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
