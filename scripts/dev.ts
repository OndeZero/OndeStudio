/**
 * Runs the API and the web dev server together: `bun dev`.
 * The API is spawned from the repo root so Bun picks up the root `.env`.
 */
const root = new URL("..", import.meta.url).pathname;

const children = [
  Bun.spawn(["bun", "--watch", "packages/api/src/app.ts"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(["bun", "run", "dev"], {
    cwd: `${root}packages/web`,
    stdout: "inherit",
    stderr: "inherit",
  }),
];

const shutdown = (): void => {
  for (const child of children) child.kill();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// If either process dies, stop the other one too instead of running half a stack.
const firstExit = await Promise.race(children.map((child) => child.exited));
shutdown();
process.exit(firstExit);
