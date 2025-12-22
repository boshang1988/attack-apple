#!/usr/bin/env node
/**
 * DeepSeek Coder CLI - AI-powered coding assistant
 */

// Fast path: Handle --version, --help, --key before any heavy imports
const rawArgs = process.argv.slice(2);

// Handle --key to set API key (simple path that works reliably)
const keyIndex = rawArgs.findIndex(arg => arg === '--key' || arg.startsWith('--key='));
if (keyIndex !== -1) {
  let keyValue: string | undefined;
  const arg = rawArgs[keyIndex];
  if (arg?.startsWith('--key=')) {
    keyValue = arg.slice(6);
  } else if (rawArgs[keyIndex + 1] && !rawArgs[keyIndex + 1]?.startsWith('-')) {
    keyValue = rawArgs[keyIndex + 1];
  }

  if (keyValue) {
    import('node:fs').then(fs => {
      import('node:path').then(path => {
        import('node:os').then(os => {
          const secretDir = path.join(os.homedir(), '.agi');
          const secretFile = path.join(secretDir, 'secrets.json');

          try {
            fs.mkdirSync(secretDir, { recursive: true });
            const existing = fs.existsSync(secretFile)
              ? JSON.parse(fs.readFileSync(secretFile, 'utf-8'))
              : {};
            existing['DEEPSEEK_API_KEY'] = keyValue;
            fs.writeFileSync(secretFile, JSON.stringify(existing, null, 2) + '\n');
            console.log('✓ DEEPSEEK_API_KEY saved to ~/.agi/secrets.json');
            process.exit(0);
          } catch (err) {
            console.error('✗ Failed to save key:', err instanceof Error ? err.message : err);
            process.exit(1);
          }
        });
      });
    });
  } else {
    console.error('Usage: deepseek --key YOUR_API_KEY');
    process.exit(1);
  }
} else if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
  import('node:fs').then(fs => {
    import('node:path').then(path => {
      import('node:url').then(url => {
        try {
          const __filename = url.fileURLToPath(import.meta.url);
          const pkgPath = path.resolve(path.dirname(__filename), '../../package.json');
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          console.log(`deepseek-coder-cli v${pkg.version || '0.0.0'}`);
        } catch {
          console.log('deepseek-coder-cli (version unknown)');
        }
        process.exit(0);
      });
    });
  });
} else if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`
deepseek-coder-cli - AI-powered coding assistant

Usage: deepseek [options] [prompt]

Modes:
  deepseek                    Start interactive shell
  deepseek "prompt"           Start with initial prompt
  deepseek -q "prompt"        Quick mode - single command
  echo "prompt" | deepseek    Pipe mode

Options:
  -v, --version       Show version
  -h, --help          Show this help
  -q, --quick         Quick mode (non-interactive)
  --key KEY           Set DeepSeek API key
  --self-test         Run self-tests

Environment:
  DEEPSEEK_API_KEY    DeepSeek API key (or use --key to set)

Commands (in interactive mode):
  /model              Switch AI model
  /secrets            Manage API keys
  /help               Show commands
  /clear              Clear screen
`);
  process.exit(0);
} else {
  void main();
}

async function main(): Promise<void> {
  // Force color support for TTY terminals
  if (process.stdout.isTTY && !process.env['NO_COLOR']) {
    process.env['FORCE_COLOR'] = process.env['FORCE_COLOR'] ?? '1';
  }

  // Self-test mode
  if (rawArgs.includes('--self-test')) {
    const { runSelfTest } = await import('./selfTest.js');
    runSelfTest().then((success) => process.exit(success ? 0 : 1)).catch(() => process.exit(1));
    return;
  }

  // Quick mode
  if (rawArgs.includes('--quick') || rawArgs.includes('-q')) {
    const { runQuickMode } = await import('../headless/quickMode.js');
    runQuickMode({ argv: rawArgs }).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
    return;
  }

  const isTTY = process.stdin.isTTY && process.stdout.isTTY;

  if (isTTY) {
    // Interactive shell
    const { runInteractiveShell } = await import('../headless/interactiveShell.js');
    runInteractiveShell({ argv: rawArgs }).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
  } else {
    // Pipe mode
    const { runQuickMode } = await import('../headless/quickMode.js');
    runQuickMode({ argv: rawArgs }).catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
  }
}
