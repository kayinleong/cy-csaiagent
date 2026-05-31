import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored shadcn/ui components — pre-existing scaffold, do not lint
    "components/ui/**",
    // Pre-existing scaffold hooks — do not lint
    "hooks/**",
  ]),

  // ── Next.js 16 anti-pattern lint gate (D-06) ──────────────────────────────
  // These rules enforce the Next.js 16 conventions that differ from older
  // versions. Violations must be fixed — not suppressed.
  {
    name: "nextjs-16-antipatterns",
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      // (1) src/ must NEVER import from app/ (core/shell boundary — TSD §3.1)
      // Format for ESLint 9 flat config: patterns as array of strings
      "no-restricted-imports": [
        "error",
        // Forbid any import of a path containing /app/ from src/ files
        "@/app",
        { name: "@/app", message: "src/ modules must not import from app/. Core/shell boundary: app/ may import src/, not the reverse. (TSD §3.1)" },
      ],

      // (2) No restricted syntax — synchronous cookies()/headers() usage.
      // In Next.js 16, both APIs are async; calling them synchronously
      // (without await) is a runtime error in RSC and silently wrong in handlers.
      "no-restricted-syntax": [
        "error",
        {
          // Catches: cookies() without await — e.g. `const c = cookies()`
          selector:
            "VariableDeclarator:not([init.type='AwaitExpression']) > CallExpression[callee.name='cookies']",
          message:
            "Next.js 16: cookies() is async — use `const cookieStore = await cookies()`. (AGENTS.md)",
        },
        {
          // Catches: headers() without await — e.g. `const h = headers()`
          selector:
            "VariableDeclarator:not([init.type='AwaitExpression']) > CallExpression[callee.name='headers']",
          message:
            "Next.js 16: headers() is async — use `const headersList = await headers()`. (AGENTS.md)",
        },
      ],
    },
  },

  // ── App-level anti-patterns ───────────────────────────────────────────────
  {
    name: "nextjs-16-app-antipatterns",
    files: ["app/**/*.ts", "app/**/*.tsx"],
    rules: {
      // Async cookies/headers must be awaited in Route Handlers and Server Components
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "VariableDeclarator:not([init.type='AwaitExpression']) > CallExpression[callee.name='cookies']",
          message:
            "Next.js 16: cookies() is async — use `const cookieStore = await cookies()`. (AGENTS.md)",
        },
        {
          selector:
            "VariableDeclarator:not([init.type='AwaitExpression']) > CallExpression[callee.name='headers']",
          message:
            "Next.js 16: headers() is async — use `const headersList = await headers()`. (AGENTS.md)",
        },
      ],
    },
  },

  // ── middleware.ts file-name gate ─────────────────────────────────────────
  // Lint any file named middleware.ts with an error pointing to proxy.ts.
  {
    name: "no-middleware-ts",
    files: ["middleware.ts", "middleware.mts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "Next.js 16 renamed Middleware to Proxy. Use proxy.ts instead of middleware.ts. (AGENTS.md, D-06)",
        },
      ],
    },
  },
]);

export default eslintConfig;
