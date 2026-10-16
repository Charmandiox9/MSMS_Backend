import autocannon from 'autocannon';
import { buildScenarios, Scenario, StressConfig } from './scenarios';

/**
 * Pruebas de estrés con autocannon contra una instancia del backend ya
 * levantada. Uso:
 *
 *   STRESS_BASE_URL=http://localhost:3001/api \
 *   STRESS_AUTH_COOKIE="token=<jwt>" \
 *   STRESS_FORMS_SECRET=<secreto> \
 *   npm run test:stress
 *
 * Variables opcionales: STRESS_SCENARIOS (lista separada por comas),
 * STRESS_DURATION (segundos), STRESS_CONNECTIONS, STRESS_MAX_P99_MS,
 * STRESS_MAX_ERROR_RATE (0-1), STRESS_ALLOW_WRITES=true, STRESS_NRC y
 * STRESS_ALLOW_REMOTE=true para apuntar a un host distinto de localhost.
 */

interface Thresholds {
  maxP99Ms: number;
  maxErrorRate: number;
}

interface Outcome {
  scenario: Scenario;
  result: autocannon.Result;
  unexpected: number;
  failures: string[];
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0)
    throw new Error(`${name} debe ser un número positivo`);
  return value;
}

function readConfig(): {
  config: StressConfig;
  thresholds: Thresholds;
  duration: number;
  connections: number;
  only?: string[];
} {
  const baseUrl = (
    process.env.STRESS_BASE_URL ?? 'http://localhost:3001/api'
  ).replace(/\/$/, '');
  const { hostname } = new URL(baseUrl);
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (!isLocal && process.env.STRESS_ALLOW_REMOTE !== 'true') {
    throw new Error(
      `STRESS_BASE_URL apunta a ${hostname}. Define STRESS_ALLOW_REMOTE=true solo para entornos de prueba; nunca contra producción.`,
    );
  }

  return {
    config: {
      baseUrl,
      authCookie: process.env.STRESS_AUTH_COOKIE || undefined,
      formsSecret: process.env.STRESS_FORMS_SECRET || undefined,
      allowWrites: process.env.STRESS_ALLOW_WRITES === 'true',
      nrc: process.env.STRESS_NRC ?? 'STRESS-NRC',
    },
    thresholds: {
      maxP99Ms: numberFromEnv('STRESS_MAX_P99_MS', 1000),
      maxErrorRate: numberFromEnv('STRESS_MAX_ERROR_RATE', 0.01),
    },
    duration: numberFromEnv('STRESS_DURATION', 20),
    connections: numberFromEnv('STRESS_CONNECTIONS', 25),
    only: process.env.STRESS_SCENARIOS?.split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  };
}

async function runScenario(
  scenario: Scenario,
  baseUrl: string,
  duration: number,
  connections: number,
  thresholds: Thresholds,
): Promise<Outcome> {
  let unexpected = 0;
  // autocannon usa el path de cada request en lugar del de la URL base.
  const { origin, pathname } = new URL(baseUrl);
  const requests = scenario.requests.map((request) => ({
    ...request,
    path: `${pathname.replace(/\/$/, '')}${request.path ?? '/'}`,
    onResponse: (status: number) => {
      if (!scenario.expectedStatus.includes(status)) unexpected += 1;
    },
  }));

  const result = await autocannon({
    url: origin,
    duration,
    connections,
    timeout: 10,
    requests,
  });
  const total = result.requests.total + result.errors + result.timeouts;
  const errorRate =
    total === 0 ? 1 : (unexpected + result.errors + result.timeouts) / total;

  const failures: string[] = [];
  if (total === 0) failures.push('no se completó ninguna solicitud');
  if (errorRate > thresholds.maxErrorRate) {
    failures.push(
      `tasa de error ${(errorRate * 100).toFixed(2)}% > ${(thresholds.maxErrorRate * 100).toFixed(2)}%`,
    );
  }
  if (result.latency.p99 > thresholds.maxP99Ms) {
    failures.push(`p99 ${result.latency.p99} ms > ${thresholds.maxP99Ms} ms`);
  }

  return { scenario, result, unexpected, failures };
}

function formatStatus(result: autocannon.Result): string {
  return Object.entries(result.statusCodeStats)
    .map(([status, { count }]) => `${status}×${count}`)
    .join(' ');
}

async function main(): Promise<void> {
  const { config, thresholds, duration, connections, only } = readConfig();
  const scenarios = buildScenarios(config).filter(
    (scenario) => !only || only.includes(scenario.name),
  );
  if (only) {
    const unknown = only.filter(
      (name) => !scenarios.some((scenario) => scenario.name === name),
    );
    if (unknown.length > 0)
      throw new Error(`Escenarios desconocidos: ${unknown.join(', ')}`);
  }

  console.log(
    `Objetivo: ${config.baseUrl} · ${connections} conexiones · ${duration}s por escenario`,
  );
  console.log(
    `Umbrales: p99 ≤ ${thresholds.maxP99Ms} ms · errores ≤ ${(thresholds.maxErrorRate * 100).toFixed(2)}%\n`,
  );

  const outcomes: Outcome[] = [];
  for (const scenario of scenarios) {
    if (scenario.skipReason) {
      console.log(`○ ${scenario.name}: omitido (${scenario.skipReason})`);
      continue;
    }
    console.log(`▶ ${scenario.name}: ${scenario.description}`);
    const outcome = await runScenario(
      scenario,
      config.baseUrl,
      duration,
      connections,
      thresholds,
    );
    outcomes.push(outcome);
    const { result } = outcome;
    console.log(
      `  ${outcome.failures.length === 0 ? '✔' : '✘'} ${result.requests.average.toFixed(0)} req/s · ` +
        `latencia p50 ${result.latency.p50} ms, p99 ${result.latency.p99} ms, máx ${result.latency.max} ms · ` +
        `inesperadas ${outcome.unexpected} · errores ${result.errors} · timeouts ${result.timeouts} · ${formatStatus(result)}`,
    );
    outcome.failures.forEach((failure) => console.log(`    - ${failure}`));
  }

  const failed = outcomes.filter((outcome) => outcome.failures.length > 0);
  console.log(
    `\n${outcomes.length - failed.length}/${outcomes.length} escenarios dentro de los umbrales`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
