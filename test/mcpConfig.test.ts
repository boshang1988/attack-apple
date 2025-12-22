import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMcpServers } from '../src/mcp/config.js';

describe('test/mcpConfig.test.ts', () => {
  it('loadMcpServers discovers workspace .mcp.json definitions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mcp-config-'));
    try {
      const configPath = join(root, '.mcp.json');
      writeFile(
        configPath,
        JSON.stringify(
          {
            filesystem: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '${WORKSPACE_ROOT}'],
              env: {
                API_KEY: '${TEST_TOKEN}', // placeholder
              },
              description: 'Workspace FS',
            },
          },
          null,
          2
        )
      );

      const servers = await loadMcpServers({
        workingDir: root,
        env: { TEST_TOKEN: 'test-token-mock' },
      });

      assert.equal(servers.length, 1);
      const server = servers[0];
      assert.ok(server);
      assert.equal(server.id, 'filesystem');
      assert.equal(server.command, 'npx');
      assert.deepEqual(server.args, ['-y', '@modelcontextprotocol/server-filesystem', root]);
      assert.equal(server.env?.['API_KEY'], 'mock-token');
      assert.equal(server.description, 'Workspace FS');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
