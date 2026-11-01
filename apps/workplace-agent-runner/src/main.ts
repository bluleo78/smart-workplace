// runner 진입점 — 설정을 읽고, 조정 루프·60초 관찰 보고·변경 스트림·/healthz 를 띄운다.
import { createServer, type Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { KubeConfig } from '@kubernetes/client-node';
import { loadConfig } from './config.js';
import { KubeCluster } from './k8s/cluster.js';
import { ReconcileLoop, Reconciler } from './reconciler.js';
import { HttpWorksClient } from './works/client.js';
import { runEventStream, type Logger } from './works/events.js';

/** 마지막 조정 성공이 이 안이면 건강하다. */
const HEALTHY_WITHIN_MS = 10 * 60_000;
/** 위치 「연결됨」은 마지막 관찰 보고가 2분 안인지로 정해진다 — 60초마다 보낸다. */
const OBSERVED_INTERVAL_MS = 60_000;

/** 한 줄 JSON 로그. 원문 키·토큰은 부르는 쪽이 넘기지 않는다(오류 메시지도 종류·이름·상태만). */
function jsonLogger(): Logger {
  const write = (level: string, msg: string, extra?: Record<string, unknown>) =>
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra })}\n`);
  return {
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  };
}

/** /healthz — 마지막 조정 성공이 10분 안이면 200, 아니면 503. 포트는 HEALTH_PORT(기본 8080 — 차트의 readinessProbe 와 같다). */
function startHealthServer(lastSuccess: () => Date | undefined, port: number): Server {
  const server = createServer((req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    const at = lastSuccess();
    const healthy = at !== undefined && Date.now() - at.getTime() < HEALTHY_WITHIN_MS;
    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ healthy, lastReconcileAt: at?.toISOString() ?? null }));
  });
  server.listen(port);
  return server;
}

async function main() {
  const log = jsonLogger();
  const cfg = loadConfig();

  const kc = new KubeConfig();
  // 클러스터 안(ServiceAccount)이 기본 — 로컬 개발은 KUBECONFIG 로
  if (process.env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
  else kc.loadFromDefault();

  const cluster = new KubeCluster(kc, cfg.namespace);
  const works = new HttpWorksClient(cfg.worksUrl, cfg.runnerToken);
  const reconciler = new Reconciler({ cluster, works, cfg, log });
  const loop = new ReconcileLoop(() => reconciler.reconcileOnce(), log);
  const abort = new AbortController();

  const health = startHealthServer(() => reconciler.lastSuccessAt, cfg.healthPort);
  log.info('runner 를 시작합니다', { namespace: cfg.namespace, works: cfg.worksUrl });

  void loop.trigger();

  const observedTimer = setInterval(() => {
    reconciler.reportObserved().catch((e: unknown) =>
      log.warn('관찰 보고 실패', { error: e instanceof Error ? e.message : String(e) }),
    );
  }, OBSERVED_INTERVAL_MS);

  void runEventStream({
    url: `${cfg.worksUrl}/api/v1/agent-runtime/runner/events`,
    token: cfg.runnerToken,
    onChange: () => void loop.trigger(),
    sleep: (ms) => sleep(ms, undefined, { signal: abort.signal }).catch(() => undefined),
    signal: abort.signal,
    log,
  });

  const shutdown = (signal: string) => {
    log.info('runner 를 멈춥니다', { signal });
    abort.abort();
    loop.stop();
    clearInterval(observedTimer);
    health.close();
    // AI Pod 는 그대로 둔다 — runner 가 다시 뜨면 클러스터의 기록(라벨·어노테이션)으로 이어 간다
    setTimeout(() => process.exit(0), 100).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e: unknown) => {
  process.stderr.write(`runner 시작 실패: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
