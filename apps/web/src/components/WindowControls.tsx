import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { errorToast } from '../lib/queries'

export const customWindow = isTauri() && /Windows/i.test(navigator.userAgent)

/** Caption buttons for the frameless Windows desktop shell, matching FixNote. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!customWindow) return
    const win = getCurrentWindow()
    let alive = true
    let unlisten: (() => void) | undefined
    const sync = () =>
      void win
        .isMaximized()
        .then((m) => alive && setMaximized(m))
        .catch(errorToast)
    sync()
    void win
      .onResized(sync)
      .then((u) => {
        if (alive) unlisten = u
        else u()
      })
      .catch(errorToast)
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])
  if (!customWindow) return null
  const win = getCurrentWindow()
  const btn =
    'flex h-full w-[46px] items-center justify-center text-foreground/80 transition-colors hover:bg-foreground/8 active:bg-foreground/12'
  return (
    <div className="flex shrink-0 items-stretch">
      <button
        type="button"
        className={btn}
        onClick={() => void win.minimize().catch(errorToast)}
        aria-label="Свернуть"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5.5h10" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => void win.toggleMaximize().catch(errorToast)}
        aria-label={maximized ? 'Восстановить окно' : 'Развернуть'}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          {maximized ? (
            <>
              <path d="M2.5 2.5V.5h7v7h-2" stroke="currentColor" />
              <rect x=".5" y="2.5" width="7" height="7" stroke="currentColor" />
            </>
          ) : (
            <rect x=".5" y=".5" width="9" height="9" stroke="currentColor" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className={`${btn} hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/85`}
        onClick={() => void win.close().catch(errorToast)}
        aria-label="Закрыть"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" />
        </svg>
      </button>
    </div>
  )
}
