import { z } from 'zod';

const UrlSchema = z.string().trim().url();

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const MAX_STDIN_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

async function readStdinText(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let totalBytes = 0;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      totalBytes += Buffer.byteLength(chunk, 'utf8');
      if (totalBytes > MAX_STDIN_SIZE_BYTES) {
        process.stdin.pause();
        reject(new Error(`stdin input exceeds maximum size of ${MAX_STDIN_SIZE_BYTES} bytes`));
        return;
      }
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', (err) => {
      reject(err);
    });
    process.stdin.resume();
  });
}

function extractUrls(text: string): string[] {
  const matches = text.matchAll(/https?:\/\/[a-z0-9\-._~%!$&'()*+,;=:@/]+/gi);
  const results: string[] = [];

  for (const match of matches) {
    const raw = match[0];
    const cleaned = raw.replace(/[),.;:!?]+$/g, '');
    if (cleaned.length > 0) {
      results.push(cleaned);
    }
  }

  return results;
}

export async function collectInputs(args: string[]): Promise<string[]> {
  const inputs: string[] = [];

  if (args.length > 0) {
    inputs.push(...args);
  }

  const shouldReadStdin = args.length === 0;
  if (shouldReadStdin) {
    if (process.stdin.isTTY) {
      return inputs;
    }
    try {
      const stdinText = await readStdinText();
      const extracted = extractUrls(stdinText);
      inputs.push(...extracted);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[WARN] Failed to read stdin: ${message}`);
    }
  }

  return inputs;
}

export function validateUrls(inputs: string[]): string[] {
  const validUrls: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const result = UrlSchema.safeParse(input);
    if (result.success) {
      if (!isHttpUrl(result.data)) {
        console.warn(`[WARN] Unsupported URL scheme skipped: ${input}`);
        continue;
      }
      if (!seen.has(result.data)) {
        seen.add(result.data);
        validUrls.push(result.data);
      }
    } else {
      console.warn(`[WARN] Invalid URL skipped: ${input}`);
    }
  }
  return validUrls;
}
