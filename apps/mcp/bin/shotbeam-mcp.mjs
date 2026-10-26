#!/usr/bin/env node
// Entry for MCP clients: `node <repo>/apps/mcp/bin/shotbeam-mcp.mjs`. Loads the TypeScript
// sources through tsx (resolved next to this file), so nothing but the server writes to stdout.
import { register } from 'tsx/esm/api'

register()
await import('../src/main.ts')
