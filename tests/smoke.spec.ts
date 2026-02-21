import { expect, test } from '@playwright/test';
import { spawn } from 'child_process';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';

const distMain = fileURLToPath(new URL('../dist/main.js', import.meta.url));

function runPwopen(
  args: string[],
  stdin?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [distMain, ...args], {
      env: {
        ...process.env,
        PWOPEN_TIMEOUT_MS: '5000',
        PWOPEN_NAVIGATION_RETRIES: '0',
        PWOPEN_RENDER_WAIT_MS: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('pwopen opens a URL passed as an argument', async () => {
  test.setTimeout(60000);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  const result = await runPwopen(['--no-sandbox', url]);

  server.close();

  expect(result.code).toBe(0);
  expect(result.stderr).not.toContain('[ERROR]');
});

test('pwopen reads URLs from stdin when no args are provided', async () => {
  test.setTimeout(60000);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>stdin</body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  const result = await runPwopen(['--no-sandbox'], `${url}\n`);

  server.close();

  expect(result.code).toBe(0);
  expect(result.stderr).not.toContain('[ERROR]');
});
