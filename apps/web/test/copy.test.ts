import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** House rule for user-facing copy: these words never appear in the app or the user-facing docs. */
it('user-facing copy never says "safe" or "scam"', () => {
  const targets = [
    ...files(join(repo, 'apps/web/src')),
    join(repo, 'apps/web/index.html'),
    join(repo, 'README.md'),
    join(repo, 'docs/CLI.md'),
  ];
  const offenders = targets.flatMap((path) =>
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line, i) =>
        /\b(safe|scam)/i.test(line) ? [`${path.slice(repo.length)}:${i + 1}: ${line.trim()}`] : [],
      ),
  );
  expect(offenders).toEqual([]);
});
