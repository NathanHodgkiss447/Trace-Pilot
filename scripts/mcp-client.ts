import '../src/config/local-env.js';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL('/mcp', process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000');
const token = process.env.MCP_BEARER_TOKEN;
if (!token) throw new Error('Set MCP_BEARER_TOKEN locally. Never put the token in a URL.');
const client = new Client({ name: 'tracepilot-demo', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  console.info('Tools:', (await client.listTools()).tools.map(t => t.name));
  const name = process.argv[2] ?? 'get_incident_context';
  if (!['get_incident_context', 'analyze_incident', 'get_investigation', 'list_incidents'].includes(name)) throw new Error('Unsupported demo tool.');
  const args = name === 'get_investigation' ? { investigationId: process.argv[3] }
    : name === 'list_incidents' ? { limit: 6 } : { incidentId: process.argv[3] ?? 'INC-1042' };
  console.info(JSON.stringify(await client.callTool({ name, arguments: args }), null, 2));
} finally { await client.close(); }
