import { createInterface } from 'node:readline/promises';

/** Everything a command needs from the terminal. Tests pass a scripted implementation. */
export interface Io {
  out(line: string): void;
  warn(line: string): void;
  /** Hidden input (vault password). */
  secret(prompt: string): Promise<string>;
  /** Yes/no question; only "y" or "yes" counts as yes. */
  confirm(prompt: string): Promise<boolean>;
}

export function terminalIo(): Io {
  return {
    out: (line) => {
      process.stdout.write(`${line}\n`);
    },
    warn: (line) => {
      process.stderr.write(`${line}\n`);
    },
    secret: readHidden,
    confirm: async (prompt) => {
      if (!process.stdin.isTTY)
        throw new Error('confirmation needs an interactive terminal (or pass --yes on testnet/local)');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const answer = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
      } finally {
        rl.close();
      }
    },
  };
}

/** Reads a line without echoing it. Works in Windows PowerShell, cmd and POSIX terminals. */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error('the vault password prompt needs an interactive terminal'));
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          return;
        }
        if (ch === '\u0003') {
          finish(new Error('cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
