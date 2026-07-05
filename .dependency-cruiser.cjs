/**
 * Dependency rules enforcing the docs/2 §3.6 import graph — checked in CI
 * (`bun run boundaries`) so the architecture defends itself without relying
 * on reviewer vigilance.
 */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    // node_modules stays OUT of exclude on purpose: excluding it would strip
    // those edges before rules run and silently kill domain-no-io-libs.
    // doNotFollow (above) keeps the edges visible without traversing them.
    exclude: { path: "/dist/|\\.test\\.ts$" },
  },
  forbidden: [
    {
      name: "no-circular",
      comment: "No import cycles anywhere; domain events break would-be cycles (docs/2 §3.4).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "shared-is-independent",
      comment: "The contract package depends on neither api nor web (docs/2 §3.3).",
      severity: "error",
      from: { path: "^packages/shared" },
      to: { path: "^packages/(api|web)" },
    },
    {
      name: "web-talks-http-only",
      comment: "The front consumes the API over HTTP, never by importing server code.",
      severity: "error",
      from: { path: "^packages/web" },
      to: { path: "^packages/api" },
    },
    {
      name: "kernel-stays-primitive",
      comment: "kernel is depended on by all modules and depends on none of them (docs/2 §3.3).",
      severity: "error",
      from: { path: "^packages/api/src/kernel" },
      to: { path: "^packages/api/src/(modules|platform)" },
    },
    {
      name: "platform-not-into-modules",
      comment: "platform is framework glue; only app.ts (composition root) wires modules together.",
      severity: "error",
      from: { path: "^packages/api/src/platform" },
      to: { path: "^packages/api/src/modules" },
    },
    {
      name: "domain-is-pure",
      comment:
        "modules/*/domain imports kernel and its own domain only — no IO, no platform, no other modules (docs/2 §3.6).",
      severity: "error",
      from: { path: "^packages/api/src/modules/([^/]+)/domain" },
      to: {
        path: "^packages/api/src",
        pathNot: "^packages/api/src/(kernel|modules/$1/domain)",
      },
    },
    {
      name: "domain-no-io-libs",
      comment: "Business rules never import HTTP/DB machinery (docs/2 §3.6).",
      severity: "error",
      from: { path: "^packages/api/src/modules/[^/]+/domain" },
      to: { path: "node_modules/(hono|@hono|drizzle-orm|drizzle-kit)" },
    },
    {
      name: "module-privacy",
      comment:
        "A module reaches another module only through its public surface index.ts (docs/2 §3.4).",
      severity: "error",
      from: { path: "^packages/api/src/modules/([^/]+)/" },
      to: {
        path: "^packages/api/src/modules/(?!$1/)[^/]+/",
        pathNot: "^packages/api/src/modules/[^/]+/index\\.ts$",
      },
    },
    {
      name: "service-stays-off-platform",
      comment:
        "Application services orchestrate domain + ports; IO touches reality only in routes/repo/adapters (docs/2 §3.6).",
      severity: "error",
      from: { path: "^packages/api/src/modules/[^/]+/service\\.ts$" },
      to: { path: "^packages/api/src/platform" },
    },
    {
      name: "io-edge-only",
      comment:
        "Within a module, only the IO edge — routes.ts, repo.ts, adapters/ — may reach platform (docs/2 §3.6); events/schema/contract/ports/index stay platform-free (service.ts has its own stricter rule).",
      severity: "error",
      from: {
        path: "^packages/api/src/modules/[^/]+/(?!routes\\.ts$|repo\\.ts$|service\\.ts$|adapters/)",
      },
      to: { path: "^packages/api/src/platform" },
    },
  ],
};
