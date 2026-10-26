import { Button } from '@shotbeam/ui'
import { Clapperboard } from 'lucide-react'
import { useState } from 'react'
import { Empty } from '../components/common'
import { NewProjectDialog } from '../components/Sidebar'

export function WelcomePage() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Empty
        icon={Clapperboard}
        title="Добро пожаловать в Shotbeam"
        action={
          <Button variant="brand" onClick={() => setOpen(true)}>
            Создать первый проект
          </Button>
        }
      >
        Проект — это бренд или продукт: его исходники, форматы, голос и готовые видео. Дальше можно
        работать руками здесь или из Claude через MCP.
      </Empty>
      <NewProjectDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
