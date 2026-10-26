import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { connectEngine } from './connect'
import { createServer } from './server'

async function main() {
  const api = await connectEngine()
  await createServer(api).connect(new StdioServerTransport())
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
  process.exit(1)
})
