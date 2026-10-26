import { Unplug } from 'lucide-react'
import { ENGINE_URL } from '../lib/api'
import { Empty } from './common'

/** The engine does not answer: say how to start it. */
export function EngineOffline() {
  return (
    <Empty icon={Unplug} title="Движок Shotbeam не запущен">
      <p>
        Интерфейс ищет его на <code className="font-mono text-xs">{ENGINE_URL}</code>. Запусти{' '}
        <code className="font-mono text-xs">pnpm dev:engine</code> в папке проекта (десктопная
        версия запускает его сама). Как только он ответит, всё подтянется.
      </p>
    </Empty>
  )
}
