import { Button } from '@shotbeam/ui'
import { useMutation } from '@tanstack/react-query'
import { Wand2 } from 'lucide-react'
import { useState } from 'react'
import { PageHeader, Section, Segmented, StatusDot } from '../components/common'
import { api } from '../lib/api'
import { errorToast, useMotionTemplates, useSetup } from '../lib/queries'

export function MotionPage() {
  const setup = useSetup().data
  const templates = useMotionTemplates().data ?? []
  const [engine, setEngine] = useState<'hyperframes' | 'remotion'>('hyperframes')
  const install = useMutation({
    mutationFn: () => api.post('/api/setup/remotion'),
    onError: errorToast,
  })
  const list = templates.filter((t) => t.engine === engine)
  const status = setup?.motion[engine]
  return (
    <div className="pb-12">
      <PageHeader
        title="Моушн"
        description="Шаблоны анимаций на двух движках. Движок выбирается для каждой сцены; новые шаблоны пишет Клод (save_motion_template)."
      />
      <div className="mx-auto max-w-4xl space-y-4 px-6">
        <div className="flex items-center gap-3">
          <Segmented
            value={engine}
            onChange={setEngine}
            options={[
              { value: 'hyperframes', label: 'HyperFrames · HTML + GSAP' },
              { value: 'remotion', label: 'Remotion · React' },
            ]}
          />
          {status ? <StatusDot ok={status.ready} label={status.detail} /> : null}
          {engine === 'remotion' && status && !status.ready ? (
            <Button
              size="sm"
              variant="brand"
              className="ml-auto"
              onClick={() => install.mutate()}
              loading={install.isPending}
            >
              Установить Remotion
            </Button>
          ) : null}
        </div>
        <Section
          title={`Шаблоны ${engine === 'hyperframes' ? 'HyperFrames' : 'Remotion'}`}
          description={
            engine === 'remotion'
              ? 'Remotion бесплатен для физлиц и команд до 3 человек; для компании больше нужна лицензия.'
              : 'HyperFrames — Apache 2.0, без ограничений.'
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {list.map((t) => (
              <div key={t.name} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Wand2 className="size-4 text-brand" />
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t.duration} с{t.overlay ? ' · поверх видео' : ''}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Переменные: {t.variables.map((v) => v.name).join(', ')}
                </p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}
