const layers = {
  models: [],
  logic: ['models'],
  controllers: ['models', 'logic', 'diplomat'],
  wire: [],
  adapters: ['wire', 'models'],
  diplomat: ['wire', 'adapters', 'controllers', 'models', 'logic'],
  infrastructure: [],
};

const layerRules = Object.entries(layers).map(([layer, allowed]) => ({
  name: `layer-${layer}`,
  severity: 'error',
  comment: `${layer} may only import ${allowed.length > 0 ? allowed.join(', ') : 'itself'} and infrastructure (service-design-principles.md, Dependency Rules).`,
  from: { path: `^src/${layer}/` },
  to: {
    path: '^src/',
    pathNot: `^src/(${[layer, ...allowed, 'infrastructure'].join('|')})/`,
  },
}));

module.exports = {
  forbidden: [
    ...layerRules,
    {
      name: 'replay-never-reaches-reasoner',
      severity: 'error',
      comment:
        'Replay must not depend on the reasoner, directly or transitively (ADR-001, service-design-principles.md): not the controller, not the replay composition, not the replay CLI, not the demo.',
      from: { path: '^(src/controllers/replay|src/diplomat/composition/(replay|shared)|src/diplomat/cli/(replay|command)|scripts/demo)\\.ts$' },
      to: { path: '^src/diplomat/reasoner/', reachable: true },
    },
    {
      name: 'no-test-imports',
      severity: 'error',
      comment: 'Shipped code and scripts never import tests; what both need lives in src/ or scripts/lib/.',
      from: { path: '^(src|scripts)/' },
      to: { path: '^tests/' },
    },
    {
      name: 'src-not-to-scripts',
      severity: 'error',
      comment: 'scripts/ compose src/, never the other way round.',
      from: { path: '^src/' },
      to: { path: '^scripts/' },
    },
    {
      name: 'controllers-use-ports-only',
      severity: 'error',
      comment: 'Controllers reach Diplomats only through port.ts types; the CLI injects implementations (ADR-003).',
      from: { path: '^src/controllers/' },
      to: { path: '^src/diplomat/', pathNot: '^src/diplomat/[^/]+/port\\.ts$' },
    },
    {
      name: 'playwright-only-in-surface',
      severity: 'error',
      comment: 'Only the surface driver may import Playwright (ADR-006); scripts/lib plays the human operator on the page.',
      from: { path: '^src/', pathNot: '^src/diplomat/surface/' },
      to: { path: '(^|node_modules/)(playwright|playwright-core|@playwright/[^/]+)(/|$)' },
    },
    {
      name: 'pure-core-no-builtins',
      severity: 'error',
      comment: 'Models and Logic are pure: no Node built-ins, hence no I/O or network.',
      from: { path: '^src/(models|logic)/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'pure-core-only-zod',
      severity: 'error',
      comment: 'Models and Logic may only import zod from npm.',
      from: { path: '^src/(models|logic)/' },
      to: { path: 'node_modules/', pathNot: 'node_modules/zod/' },
    },
    {
      name: 'fs-confined',
      severity: 'error',
      comment: 'In src/, node:fs is only used by the artifact store, the evidence recorder and infrastructure.',
      from: { path: '^src/', pathNot: '^src/(diplomat/(store|evidence)|infrastructure)/' },
      to: { dependencyTypes: ['core'], path: '^(node:)?fs(/promises)?$' },
    },
    {
      name: 'no-fixture-imports',
      severity: 'error',
      comment: 'The system sees the target app only through the browser (ADR-004).',
      from: { path: '^src/' },
      to: { path: '^fixture/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
};
