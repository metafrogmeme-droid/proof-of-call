import type { Io } from '../../src/io.js';

export interface TestIo extends Io {
  lines: string[];
  warnings: string[];
  secrets: string[];
  confirms: string[];
}

/** Scripted terminal: answers every password prompt with `password` and every confirmation with `confirm`. */
export function testIo(opts: { password?: string; confirm?: boolean } = {}): TestIo {
  const io: TestIo = {
    lines: [],
    warnings: [],
    secrets: [],
    confirms: [],
    out: (line) => io.lines.push(line),
    warn: (line) => io.warnings.push(line),
    secret: (prompt) => {
      io.secrets.push(prompt);
      return Promise.resolve(opts.password ?? '');
    },
    confirm: (prompt) => {
      io.confirms.push(prompt);
      return Promise.resolve(opts.confirm ?? false);
    },
  };
  return io;
}
