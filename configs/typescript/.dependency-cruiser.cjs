// hypear-baseline dependency-cruiser config.
// Install: pnpm add -D dependency-cruiser
// Adjust the boundary rules below to match the project's packages.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules hard to reason about and test.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Files nothing imports are usually dead code.',
      from: { orphan: true, pathNot: ['\.d\.ts$', '(^|/)tsconfig', '\.config\.[cm]?[jt]s$', '(^|/)test/'] },
      to: {},
    },
    {
      name: 'core-is-standalone',
      severity: 'error',
      comment: 'Shared packages must not depend on apps.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'renderer-no-node',
      severity: 'error',
      comment: 'Electron renderer code must not import Node built-ins or the main process.',
      from: { path: '/renderer/' },
      to: { path: ['^node:', '/main/'], dependencyTypes: ['core', 'local'] },
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment: 'Shared package code must not import devDependencies. (Bundled apps, such as Electron apps, often list all deps as dev and are excluded.)',
      from: { path: '^packages/[^/]+/src/', pathNot: ['\.test\.', '\.spec\.'] },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(out|dist|coverage)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  },
}
