/* ------------------------------------------------------------------ */
/* App version + commit: shown by GET /api/health (monitoring) and     */
/* written into every backup manifest, so a restore knows which code   */
/* produced the data. The commit comes from OPENFS_COMMIT (set it in   */
/* Docker images / release tarballs) or, in a git checkout, from git.  */
/* ------------------------------------------------------------------ */

import pkg from "../../package.json";

export const APP_VERSION: string = pkg.version;

let commit: string | null = null;

export function appCommit(env: Record<string, string | undefined> = process.env): string {
  if (env.OPENFS_COMMIT?.trim()) return env.OPENFS_COMMIT.trim();
  if (commit !== null) return commit;
  commit = "";
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "--short=12", "HEAD"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode === 0) commit = result.stdout.toString().trim();
  } catch {
    // no git binary — leave it empty
  }
  return commit;
}

export function appVersion() {
  return { version: APP_VERSION, commit: appCommit() };
}
