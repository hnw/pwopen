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

async function readStdinText(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data);
    });
    process.stdin.on('error', () => {
      resolve('');
    });
    process.stdin.resume();
  });
}

function extractUrls(text: string): string[] {
  const matches = text.matchAll(/https?:\/\/[^\s<>"']+/g);
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
    const stdinText = await readStdinText();
    const extracted = extractUrls(stdinText);
    inputs.push(...extracted);
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
