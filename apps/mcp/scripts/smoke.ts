// Starts the MCP server over stdio like Claude does and calls a few tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['bin/shotbeam-mcp.mjs'],
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
})
const client = new Client({ name: 'smoke', version: '0' })
await client.connect(transport)
const { tools } = await client.listTools()
console.log(`${tools.length} tools:`, tools.map((t) => t.name).join(', '))
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args })
  for (const c of r.content as { type: string; text?: string; data?: string }[]) {
    console.log(
      `--- ${name} ${c.type === 'text' ? '' : `(${c.type}, ${c.data?.length} b64 chars)`}`,
    )
    if (c.text) console.log(c.text.slice(0, 1500))
  }
}
for (const [name, args] of JSON.parse(process.argv[2] ?? '[]') as [
  string,
  Record<string, unknown>,
][]) {
  await call(name, args)
}
await client.close()
