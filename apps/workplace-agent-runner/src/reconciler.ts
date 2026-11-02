// 조정 — desired 를 받아 planReconcile 대로 Pod·PVC·Secret·ConfigMap 을 맞추고, 관찰 상태를 보고한다.
// 메모리에 들고 있는 것은 「마지막 desired」와 「AI 별 실패 사유」뿐이다. 받은 키·STOPPED 미보고 같은 기록은
// 모두 클러스터(Secret 어노테이션·남은 ConfigMap)에 있어 runner 가 언제 다시 떠도 같은 판단을 한다.
import type { V1Secret } from '@kubernetes/client-node';
import type { RunnerConfig } from './config.js';
import { ClusterError, type ClusterApi, type ManagedKind, type ManagedResources, type PodUsage } from './k8s/cluster.js';
import {
  ANN_AGENT_KEY_ID,
  ANN_AGENT_KEY_ROTATE_AFTER,
  ANN_CLAUDE_VERSION,
  ANN_REPO_HOSTS,
  ANN_REPOS_VERSION,
  ANN_WORK_NODE,
  SECRET_AGENT_KEY,
  SECRET_CLAUDE_TOKEN,
  SECRET_REPO_PREFIX,
  formatRepoHosts,
  repoSecretKey,
  type RepoMount,
  buildAgentResources,
  buildAgentSecret,
  configMapName,
  podName,
  pvcName,
  secretName,
  type AgentContext,
} from './k8s/manifest.js';
import { clip, toObserved } from './observe.js';
import {
  checkImages,
  collectActual,
  emptyActual,
  ownedByLocation,
  planReconcile,
  type Action,
  type ActualAgent,
} from './plan.js';
import { secretFetches } from './secrets.js';
import type { RunnerDesired, RunnerDesiredAgent, RunnerObservedAgent, WorksClient } from './works/client.js';
import type { Logger } from './works/events.js';

/** 관찰 보고 한 번에 실을 수 있는 최대 AI 수(Works 제한). */
const OBSERVED_BATCH = 200;
/** AI 별 조정을 동시에 몇 명까지 — AI 끼리는 독립이라 나눠 돌리되 API 서버를 한꺼번에 두드리지 않게. */
const CONCURRENCY = 4;
const NON_ANTHROPIC_MESSAGE = 'Claude Code 템플릿은 Anthropic 연결만 씁니다';

/**
 * 남은 일이 있을 때 다음 회차를 언제 볼지.
 * - soon: 일시 오류·키 받기 실패·STOPPED 보고 실패 — 곧 다시 시도한다
 * - wait: 지우는 중인 Pod·PVC 가 사라지기만 기다린다 — 클러스터가 할 일이라 조금 느긋하게
 * - later: 클러스터가 apply·delete 를 거절함(쿼터·PodSecurity·검증) — 다시 보내도 대개 같은 답이라 늦게.
 *   쿼터가 풀리는 것처럼 저절로 나으면 그 회차에 그대로 만든다.
 */
export type Retry = 'soon' | 'wait' | 'later';

/** Retry 별 다음 회차까지의 간격. 여러 AI 의 결과를 합칠 때는 짧은 쪽이 이긴다({@link sooner}). */
export const RETRY_MS: Record<Retry, number> = { soon: 5_000, wait: 15_000, later: 30_000 };
/** desired·목록 조회 자체가 실패했을 때 다음 회차까지. */
export const RETRY_ON_ERROR_MS = 30_000;

/** 두 재시도 중 더 빨리 다시 봐야 하는 쪽(없으면 다른 쪽). */
export function sooner(a: Retry | undefined, b: Retry | undefined): Retry | undefined {
  if (!a || !b) return a ?? b;
  return RETRY_MS[a] <= RETRY_MS[b] ? a : b;
}

export interface ReconcileResult {
  /** 곧 다시 볼 일이 남았으면 언제 볼지 — 없으면 desired 의 주기 조회에 맡긴다. */
  retry?: Retry;
  /** desired 가 알려 준 주기 조회 간격. */
  pollIntervalSeconds: number;
}

export interface ReconcilerDeps {
  cluster: ClusterApi;
  works: WorksClient;
  cfg: RunnerConfig;
  now?: () => Date;
  log: Logger;
}

/**
 * Secret 준비 결과 — ok 면 agent-key 가 Secret 에 있다(Pod 를 만들어도 된다). claudeVersion 은 지금 Secret 에 적힌 모델 연결 version
 * (없으면 undefined) — Pod 어노테이션과 비교해 다르면 Pod 를 다시 만든다.
 */
type SecretOutcome =
  | { ok: true; claudeVersion: string | undefined; repos: RepoMount; workNode: string | undefined }
  | { ok: false; message?: string };

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function decodeData(secret: V1Secret | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(secret?.data ?? {}).map(([k, v]) => [k, Buffer.from(v, 'base64').toString('utf8')]),
  );
}

/** 같은 이름의 남의 리소스(runner 라벨 없음·다른 위치)가 있어 만들지 않을 때의 사유. */
const foreignMessage = (kind: ManagedKind, name: string) => `같은 이름의 리소스(${kind}/${name})가 이미 있어 만들지 않습니다`;

/**
 * 비밀값 version 이 Pod(만들 때 어노테이션에 넣은 것)와 Secret(지금) 사이에 다른지 — 없음 ↔ 값 포함도 다름이다.
 * 모델 연결 토큰·gh 로그인은 Pod 시작 때 고정되므로 등록·교체·폐기하면 Pod 를 다시 만들어야 반영된다.
 */
const versionChanged = (podVersion: string | undefined, secretVersion: string | undefined) =>
  (podVersion ?? null) !== (secretVersion ?? null);

/** items 를 limit 개씩 동시에 fn 에 넘기고 결과를 같은 순서로 돌려준다. fn 은 던지지 않아야 한다(부르는 쪽이 잡는다). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 한 회차 동안 AI 별 조정이 함께 보는 값. stops 는 STOPPED 를 모아 보낼 AI(회차 끝에 한 번에). */
interface Round {
  actualById: Map<number, ActualAgent>;
  desiredById: Map<number, RunnerDesiredAgent>;
  secretsByName: Map<string, V1Secret>;
  ctx: AgentContext;
  stops: ActualAgent[];
}

const sameRecord = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

export class Reconciler {
  private readonly cluster: ClusterApi;
  private readonly works: WorksClient;
  private readonly cfg: RunnerConfig;
  private readonly now: () => Date;
  private readonly log: Logger;

  /** 마지막으로 받은 desired — 관찰 보고가 「보고할 AI」를 정할 때 쓴다. */
  private lastDesired: RunnerDesired | undefined;
  /** AI 별 실패 사유(허용 밖 이미지·이름 충돌·모델 연결 종류·클러스터 거절) — 관찰 보고에서 FAILED 로 덮는다. */
  private readonly failures = new Map<number, string>();
  /** 마지막으로 조정이 끝까지 돈 시각(/healthz). */
  lastSuccessAt: Date | undefined;

  constructor(deps: ReconcilerDeps) {
    this.cluster = deps.cluster;
    this.works = deps.works;
    this.cfg = deps.cfg;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log;
  }

  /**
   * 조정 한 회차. desired·목록 조회가 실패하면 던진다(부르는 쪽이 다시 시도). AI 하나의 실패는 다른 AI 를 막지 않는다.
   * AI 별 조정은 동시에 {@link CONCURRENCY} 명까지 돌고, STOPPED 는 회차 끝에 모아 보낸다.
   */
  async reconcileOnce(): Promise<ReconcileResult> {
    const desired = await this.works.getDesired();
    this.lastDesired = desired;
    const { resources, actual } = await this.observeCluster(desired.locationId);
    const desiredById = new Map(desired.agents.map((a) => [a.agentUserId, a]));
    const round: Round = {
      actualById: new Map(actual.map((a) => [a.agentUserId, a])),
      desiredById,
      secretsByName: new Map(resources.secrets.map((s) => [s.metadata?.name ?? '', s])),
      ctx: { locationId: desired.locationId, apiUrl: desired.apiUrl, mcpUrl: desired.mcpUrl },
      stops: [],
    };

    // desired 에서 빠진 AI 의 실패 기록은 버린다
    for (const id of [...this.failures.keys()]) if (!desiredById.has(id)) this.failures.delete(id);

    // planReconcile 은 AI 마다 할 일 하나지만 id 로 한 번 더 거른다 — desired 에 같은 id 가 두 번 와도 한 AI 를 동시에 두 번 다루지 않게
    const seen = new Set<number>();
    const actions = planReconcile(desired.agents, actual).filter((a) => {
      if (seen.has(a.agentUserId)) return false;
      seen.add(a.agentUserId);
      return true;
    });
    const retries = await mapLimit(actions, CONCURRENCY, (action) => this.runAction(action, round));
    const retry = sooner(retries.reduce(sooner, undefined), await this.reportStopped(round.stops));

    this.lastSuccessAt = this.now();
    return { retry, pollIntervalSeconds: desired.pollIntervalSeconds };
  }

  /** 내 위치의 runner 리소스와 그것을 AI 별로 묶은 것 — 다른 위치 runner 리소스는 「내 것」이 아니라 지우지도 보고하지도 않는다. */
  private async observeCluster(locationId: number): Promise<{ resources: ManagedResources; actual: ActualAgent[] }> {
    const resources = ownedByLocation(await this.cluster.listManaged(), locationId);
    return { resources, actual: collectActual(resources) };
  }

  /** AI 한 명의 할 일. 던지지 않는다 — 실패는 재시도 간격으로 바꿔 돌려준다. */
  private async runAction(action: Action, round: Round): Promise<Retry | undefined> {
    const id = action.agentUserId;
    const current = round.actualById.get(id) ?? emptyActual(id);
    try {
      switch (action.kind) {
        case 'create':
        case 'recreate':
        case 'keep':
          return await this.reconcileDesired(
            action.kind,
            round.desiredById.get(id)!,
            current,
            round.secretsByName.get(secretName(id)),
            round.ctx,
          );
        case 'delete':
          await this.deleteAgent(current);
          return 'wait';
        case 'reportStopped': {
          // 남은 PVC·Secret 을 지우고, STOPPED 를 보낼 일이 있으면 회차 끝 묶음에 넣는다(결과는 reportStopped 가 정한다)
          const issued = await this.deleteLeftovers(current);
          // ConfigMap 이 이미 없고(= STOPPED 가 받아들여짐) 남은 것이 모두 지워지는 중이면 아무것도 다시 보내지 않는다 —
          // 남은 PVC 가 사라지는 것은 클러스터 몫이라 곧 다시 볼 필요도 없다(주기 조회가 확인)
          if (current.configMap || issued) round.stops.push(current);
          return undefined;
        }
      }
    } catch (e) {
      return this.actionFailed(id, action.kind, e, round.desiredById.has(id));
    }
  }

  /**
   * AI 조정 실패를 재시도 간격으로. 클러스터가 거절했으면(쿼터·PodSecurity·검증) — 로그만 남기면 관리자 화면엔 STARTING 으로만
   * 보이므로 사유를 FAILED 로 알리고 늦게 다시 본다. desired 에서 빠진(지우는 중) AI 는 관찰 보고가 STOPPING/STOPPED 라
   * FAILED 를 싣지 않고 로그로만 남긴다. 그 밖(404·409·429·5xx·네트워크)은 일시 오류로 곧 다시.
   */
  private actionFailed(id: number, action: string, e: unknown, inDesired: boolean): Retry {
    if (e instanceof ClusterError && e.rejected) {
      if (inDesired) this.fail(id, e.message);
      this.log.error('클러스터가 AI 조정을 거절했습니다 — 30초 뒤 다시 봅니다', { agentUserId: id, action, error: e.message });
      return 'later';
    }
    this.log.error('AI 조정 실패', { agentUserId: id, action, error: errMessage(e) });
    return 'soon';
  }

  /** desired 에 있는 AI 한 명. 끝났으면 undefined, 남은 일이 있으면 언제 다시 볼지. */
  private async reconcileDesired(
    kind: 'create' | 'recreate' | 'keep',
    agent: RunnerDesiredAgent,
    current: ActualAgent,
    existingSecret: V1Secret | undefined,
    ctx: AgentContext,
  ): Promise<Retry | undefined> {
    const id = agent.agentUserId;
    // 이미지 검사는 Pod 를 지우거나 만들기 직전에 쓴다. create·recreate 는 키를 받기 전에 본다 — 띄우지 못할 AI 의 키를 받으면
    // 그 자체가 교체(generation+1)이고, recreate 는 허용 밖 이미지로 바뀐 템플릿 때문에 멀쩡히 돌던 Pod 를 지우지 않게.
    const imageProblem = checkImages(agent, this.cfg.allowedImagePrefixes);
    if (kind !== 'keep' && imageProblem) {
      this.fail(id, imageProblem);
      return undefined;
    }
    if (kind === 'create' && this.diskFor(current) === 'pvc' && current.pvcDeleting) {
      // 끄고 곧바로 다시 켬 — 지워지는 중인 PVC 에 새 Pod 를 붙이면 서로 기다리며 멈춘다. 사라진 뒤 새로 만든다(그동안 키도 받지 않는다)
      this.log.info('지워지는 중인 작업 디스크가 사라지기를 기다립니다', { agentUserId: id });
      this.failures.delete(id);
      return 'wait';
    }
    if (kind === 'create') {
      const foreign = await this.findForeign(current, id);
      if (foreign) {
        this.fail(id, foreign);
        return undefined;
      }
    }

    // 키 교체·모델 연결 변경은 Pod 를 두고도 Secret 에 반영한다(keep 포함 — agent-key 는 파일로 마운트돼 떠 있는 Pod 도 새 키를 본다)
    const secret = await this.ensureSecret(kind, agent, current, existingSecret, ctx);
    if (!secret.ok) {
      // 바뀌지 않을 실패(provider·이름 충돌)는 주기 조회에 맡기고, 키를 아직 못 받았으면 곧 다시
      if (secret.message) {
        this.fail(id, secret.message);
        return undefined;
      }
      return 'soon';
    }
    // keep 인데 모델 연결이 바뀜 → Pod 를 갈아야 한다. 지우기 전에 이미지를 본다 — 허용 밖이면 지운 뒤 다시 만들지 못한다
    const swapPod =
      kind === 'keep' &&
      current.pod !== undefined &&
      !current.pod.deleting &&
      (versionChanged(current.pod.claudeVersion, secret.claudeVersion) ||
        versionChanged(current.pod.reposVersion, secret.repos.version));
    if (swapPod && imageProblem) {
      this.fail(id, imageProblem);
      return undefined;
    }
    // 실패 기록은 이 AI 의 할 일이 끝까지 된 뒤에 지운다 — 중간(Pod apply 거절 등)에 관찰 보고가 끼어들어도 사유가 사라지지 않게
    const done = await this.convergePod(kind, agent, current, swapPod, secret, ctx);
    this.failures.delete(id);
    return done ? undefined : 'wait';
  }

  /**
   * Secret 이 준비된 AI 의 Pod 를 맞춘다. true 끝남 · false 지우는 중인 Pod 가 사라지기를 기다림.
   * swapPod: keep 인데 모델 연결이 바뀌어 Pod 를 다시 만들어야 함(이미지 검사는 부르는 쪽이 끝냈다).
   */
  private async convergePod(
    kind: 'create' | 'recreate' | 'keep',
    agent: RunnerDesiredAgent,
    current: ActualAgent,
    swapPod: boolean,
    secret: { claudeVersion: string | undefined; repos: RepoMount; workNode: string | undefined },
    ctx: AgentContext,
  ): Promise<boolean> {
    const id = agent.agentUserId;

    if (kind === 'keep') {
      // 지우는 중인 Pod 는 사라지면 다음 회차에 create
      if (!swapPod) return !current.pod?.deleting;
      // 모델 연결 토큰은 env(CLAUDE_CODE_OAUTH_TOKEN)로 들어가 Pod 시작 때 고정된다. Works 는 연결 재등록에 generation 을
      // 올리지 않으므로(언제 다시 만들지는 runner 몫) Secret 의 version 이 Pod 의 것과 다르면 generation·applyNow 와 무관하게
      // 바로 다시 만든다 — 재등록은 대개 옛 토큰이 끊겼을 때라 기다리면 AI 가 모델을 못 부른 채 남는다.
      // 저장소 토큰도 같다 — gh 로그인이 Pod 시작 때 고정되고 Works 는 토큰 변경에 generation 을 올리지 않는다.
      this.log.info('모델 연결·저장소 토큰이 바뀌어 Pod 를 다시 만듭니다', { agentUserId: id });
      await this.cluster.delete('Pod', podName(id));
      return false;
    }

    if (kind === 'recreate') {
      // Pod 만 지운다 — PVC·Secret 은 그대로. 사라지면 다음 회차에 create
      this.log.info('generation 이 바뀌어 Pod 를 다시 만듭니다', { agentUserId: id, generation: agent.generation });
      await this.cluster.delete('Pod', podName(id));
      return false;
    }

    // create — PVC 는 pvc 방식에서 없을 때만(크기를 줄이거나 바꾸는 apply 는 실패할 수 있다), ConfigMap 은 새 generation 으로.
    // hostPath 방식은 Secret 에 적어 둔 노드에 고정한다(처음이면 아무 노드 — 뜬 뒤 ensureSecret 이 노드를 적는다)
    const { pod, pvc, configMap } = buildAgentResources(agent, ctx, this.cfg, {
      claudeVersion: secret.claudeVersion,
      workNode: secret.workNode,
      repos: secret.repos,
      workDisk: this.diskFor(current),
    });
    if (pvc && !current.pvc) await this.cluster.apply(pvc);
    await this.cluster.apply(configMap);
    await this.cluster.apply(pod);
    this.log.info('Pod 를 만들었습니다', { agentUserId: id, generation: agent.generation });
    return true;
  }

  /**
   * 이 AI 의 작업 디스크 방식. 설정이 pvc 이거나, pvc 방식으로 설치했던 위치를 hostPath 로 올린 직후라 이미 (지워지는 중이 아닌) PVC 가 있으면
   * pvc — 끌 때까지 그 PVC 를 계속 써 작업 폴더를 잃지 않게. 끄면 PVC 가 지워지고 다음에 켤 때부터 노드 폴더를 쓴다.
   */
  private diskFor(current: ActualAgent): 'pvc' | 'hostPath' {
    return this.cfg.workDiskType === 'pvc' || (current.pvc && !current.pvcDeleting) ? 'pvc' : 'hostPath';
  }

  /** runner 라벨이 없는데 이름이 같은 리소스 — 덮어쓰면 남의 것을 가져가게 되니 찾아서 사유를 돌려준다(없으면 null). */
  private async findForeign(current: ActualAgent, id: number): Promise<string | null> {
    // hostPath 방식은 PVC 를 만들지 않으니 이름 겹침도 보지 않는다(diskFor 가 정한 방식 기준)
    const checks: [ManagedKind, string, boolean][] = [
      ['Secret', secretName(id), current.secret],
      ...(this.diskFor(current) === 'pvc' ? [['PersistentVolumeClaim', pvcName(id), current.pvc] as [ManagedKind, string, boolean]] : []),
      ['ConfigMap', configMapName(id), current.configMap],
      ['Pod', podName(id), Boolean(current.pod)],
    ];
    // 서로 독립인 GET 이라 한꺼번에 묻고, 알릴 때는 위 순서의 첫 것을 쓴다
    const found = await Promise.all(
      checks
        .filter(([, , managed]) => !managed)
        .map(async ([kind, name]) => ((await this.cluster.exists(kind, name)) ? foreignMessage(kind, name) : null)),
    );
    return found.find((m) => m !== null) ?? null;
  }

  /**
   * Secret 을 desired 의 비밀값 버전에 맞춘다. 받은 키·버전은 원문과 같은 apply 로 어노테이션에 적는다 —
   * 중간에 죽어도 「원문은 있는데 기록이 없어 다시 받는(=교체)」 일이 없게. 원문은 로그에 남기지 않는다.
   */
  private async ensureSecret(
    kind: 'create' | 'recreate' | 'keep',
    agent: RunnerDesiredAgent,
    current: ActualAgent,
    existing: V1Secret | undefined,
    ctx: AgentContext,
  ): Promise<SecretOutcome> {
    const id = agent.agentUserId;
    // create 는 findForeign 이 방금 같은 이름을 봤다 — 한 번만 묻는다
    if (kind !== 'create' && !current.secret && (await this.cluster.exists('Secret', secretName(id)))) {
      return { ok: false, message: foreignMessage('Secret', secretName(id)) };
    }
    const oldAnn = { ...(existing?.metadata?.annotations ?? {}) };
    const oldData = decodeData(existing);
    const ann = { ...oldAnn };
    const data = { ...oldData };
    const fetches = secretFetches(agent.secrets, ann, this.now());

    // 원문을 받다 실패함 — 이미 떠 있는 Pod 는 옛 값으로 두고, 새 Pod 는 다 받은 뒤에 만든다
    let fetchError: unknown;
    if (fetches.agentKey) {
      try {
        const key = await this.works.issueAgentKey(id);
        data[SECRET_AGENT_KEY] = key.plaintext;
        ann[ANN_AGENT_KEY_ID] = String(key.keyId);
        ann[ANN_AGENT_KEY_ROTATE_AFTER] = new Date(key.rotateAfter).toISOString();
        this.log.info('AI 키를 받았습니다', { agentUserId: id, keyId: key.keyId });
      } catch (e) {
        fetchError = e;
        this.log.warn('AI 키를 받지 못했습니다', { agentUserId: id, error: errMessage(e) });
        // 쓸 키가 하나도 없으면 아무것도 쓰지 않고 다음 회차에 다시 받는다
        if (!data[SECRET_AGENT_KEY]) return { ok: false };
      }
    }

    let failure: string | undefined;
    const clearClaude = () => {
      delete data[SECRET_CLAUDE_TOKEN];
      delete ann[ANN_CLAUDE_VERSION];
    };
    if (fetches.claude === 'clear') {
      // 연결 없음 — 남은 토큰을 지운다
      clearClaude();
    } else if (fetches.claude === 'fetch') {
      try {
        const s = await this.works.getClaudeSecret(id);
        if (!s) {
          clearClaude();
        } else if (s.provider !== 'anthropic') {
          failure = NON_ANTHROPIC_MESSAGE;
        } else {
          data[SECRET_CLAUDE_TOKEN] = s.payload;
          ann[ANN_CLAUDE_VERSION] = String(s.version);
        }
      } catch (e) {
        // 모델 연결을 못 받아도 받은 AI 키는 아래에서 꼭 적는다
        this.log.warn('모델 연결을 받지 못했습니다', { agentUserId: id, error: errMessage(e) });
        fetchError = fetchError ?? e;
      }
    }

    const clearRepos = () => {
      for (const k of Object.keys(data)) if (k.startsWith(SECRET_REPO_PREFIX)) delete data[k];
      delete ann[ANN_REPOS_VERSION];
      delete ann[ANN_REPO_HOSTS];
    };
    if (fetches.repos === 'clear') {
      // 등록 없음·템플릿이 요구하지 않음 — 남은 토큰을 지운다
      clearRepos();
    } else if (fetches.repos === 'fetch') {
      try {
        const r = await this.works.getRepoSecrets(id);
        // 기존 repo-* 키를 모두 바꿔 넣는다 — 빠진 호스트의 키는 남기지 않는다. 원문은 로그에 남기지 않는다.
        clearRepos();
        if (r.version !== null) {
          for (const t of r.tokens) data[repoSecretKey(t.kind, t.host)] = t.token;
          ann[ANN_REPOS_VERSION] = String(r.version);
          if (r.tokens.length) ann[ANN_REPO_HOSTS] = formatRepoHosts(r.tokens);
          this.log.info('저장소 토큰을 받았습니다', { agentUserId: id, hosts: r.tokens.length });
        } else {
          // desired 는 버전을 냈는데 받으러 간 사이 모두 폐기됨 — desired 의 버전을 적어 두어 desired 가 다시 바뀔 때까지
          // 회차마다 다시 받으러 가지 않게 한다(토큰 없이 둔다)
          const desiredVersion = agent.secrets.find((ref) => ref.name === 'repos')?.version;
          if (desiredVersion != null) ann[ANN_REPOS_VERSION] = String(desiredVersion);
        }
      } catch (e) {
        this.log.warn('저장소 토큰을 받지 못했습니다', { agentUserId: id, error: errMessage(e) });
        fetchError = fetchError ?? e;
      }
    }

    // hostPath 작업 디스크 노드 — Pod 가 처음 배치되면 그 노드를 적어 둔다. 다시 만들 때(generation·모델 연결 교체) 같은 노드에
    // 고정해 작업 폴더를 잃지 않게. 이미 적힌 값은 바꾸지 않는다(고정된 Pod 는 그 노드에만 뜨므로 같은 값이다).
    if (this.cfg.workDiskType === 'hostPath' && !ann[ANN_WORK_NODE] && current.pod?.nodeName && !current.pod.deleting) {
      ann[ANN_WORK_NODE] = current.pod.nodeName;
      this.log.info('작업 디스크 노드를 기록했습니다', { agentUserId: id, node: current.pod.nodeName });
    }

    if (!sameRecord(data, oldData) || !sameRecord(ann, oldAnn)) {
      await this.cluster.apply(buildAgentSecret(id, ctx.locationId, this.cfg.namespace, data, ann));
    }

    if (failure) return { ok: false, message: failure };
    if (!data[SECRET_AGENT_KEY]) return { ok: false };
    if (fetchError && !current.pod) return { ok: false };
    return {
      ok: true,
      claudeVersion: ann[ANN_CLAUDE_VERSION],
      repos: { version: ann[ANN_REPOS_VERSION], hosts: ann[ANN_REPO_HOSTS] },
      workNode: ann[ANN_WORK_NODE],
    };
  }

  /**
   * PVC·Secret 중 아직 지우지 않은 것을 지운다. 이미 deletionTimestamp 가 있으면(파이널라이저 — PVC 는 Pod 가 남아 있는 동안
   * pvc-protection 으로 Terminating 에 머문다) 삭제를 다시 내지 않는다. 하나라도 냈으면 true.
   */
  private async deleteLeftovers(a: ActualAgent): Promise<boolean> {
    const id = a.agentUserId;
    let issued = false;
    if (a.pvc && !a.pvcDeleting) {
      await this.cluster.delete('PersistentVolumeClaim', pvcName(id));
      issued = true;
    }
    if (a.secret && !a.secretDeleting) {
      await this.cluster.delete('Secret', secretName(id));
      issued = true;
    }
    return issued;
  }

  /** desired 에서 빠진 AI — Pod·PVC·Secret 을 지운다. ConfigMap 은 STOPPED 보고 뒤까지 남긴다. */
  private async deleteAgent(a: ActualAgent): Promise<void> {
    const id = a.agentUserId;
    if (a.pod && !a.pod.deleting) {
      this.log.info('desired 에서 빠져 Pod 를 지웁니다', { agentUserId: id });
      await this.cluster.delete('Pod', podName(id));
    }
    await this.deleteLeftovers(a);
  }

  /**
   * Pod 가 사라진 AI 들의 STOPPED 를 모아 {@link OBSERVED_BATCH} 명씩 보내고, 받아들여진 묶음의 ConfigMap 을 지운다.
   * 2xx 면 updated 든 ignored(다른 위치로 옮김·AI 삭제)든 더 보낼 곳이 없다. 보내지 못한 묶음은 ConfigMap 을 남겨 곧 다시 보낸다.
   */
  private async reportStopped(stops: ActualAgent[]): Promise<Retry | undefined> {
    const sorted = [...stops].sort((a, b) => a.agentUserId - b.agentUserId);
    let retry: Retry | undefined;
    for (let i = 0; i < sorted.length; i += OBSERVED_BATCH) {
      const chunk = sorted.slice(i, i + OBSERVED_BATCH);
      try {
        await this.works.reportObserved(
          chunk.map((a) => ({ agentUserId: a.agentUserId, ...toObserved(undefined, true), cpuMillicores: null, memoryBytes: null })),
        );
      } catch (e) {
        this.log.warn('STOPPED 보고 실패 — 다시 보냅니다', { agentUserIds: chunk.map((a) => a.agentUserId), error: errMessage(e) });
        retry = sooner(retry, 'soon');
        continue;
      }
      const results = await mapLimit(chunk, CONCURRENCY, async (a): Promise<Retry | undefined> => {
        const id = a.agentUserId;
        try {
          if (a.configMap) await this.cluster.delete('ConfigMap', configMapName(id));
        } catch (e) {
          return this.actionFailed(id, 'reportStopped', e, false);
        }
        this.log.info('STOPPED 를 보내고 정리를 끝냈습니다', { agentUserId: id });
        // 남은 PVC·Secret 은 방금 삭제를 냈거나 지워지는 중 — 사라지기만 기다린다
        return a.pvc || a.secret ? 'wait' : undefined;
      });
      retry = results.reduce(sooner, retry);
    }
    return retry;
  }

  private fail(id: number, message: string) {
    if (this.failures.get(id) !== message) this.log.warn('AI 를 띄우지 않습니다', { agentUserId: id, reason: message });
    this.failures.set(id, message);
  }

  /**
   * 작업 화면 보기(WP-1277) — 그 AI 의 Pod 가 내 위치에서 떠 있으면(Running, 지우는 중 아님) Pod 이름. desired 를 아직 못 받았으면 null.
   * 위치 라벨로 거르므로 같은 네임스페이스의 다른 runner 가 띄운 AI 에는 붙지 않는다.
   */
  async findRunningAgentPod(agentUserId: number): Promise<string | null> {
    const desired = this.lastDesired;
    if (!desired) return null;
    const { resources } = await this.observeCluster(desired.locationId);
    const name = podName(agentUserId);
    const pod = resources.pods.find((p) => p.metadata?.name === name);
    return pod && !pod.metadata?.deletionTimestamp && pod.status?.phase === 'Running' ? name : null;
  }

  /**
   * 관찰 보고(60초마다) — desired 의 모든 AI + 지우는 중인 AI. 변화가 없어도, AI 가 하나도 없어도 보낸다
   * (위치의 「연결됨」이 이 호출로 정해진다). metrics.k8s.io 가 없으면 사용량은 비우고 metricsAvailable=false 를 함께 보낸다.
   */
  async reportObserved(): Promise<void> {
    const desired = this.lastDesired;
    if (!desired) return;
    const { resources, actual } = await this.observeCluster(desired.locationId);
    const podsByName = new Map(resources.pods.map((p) => [p.metadata?.name ?? '', p]));
    let usage = new Map<string, PodUsage>();
    // 사용량을 잴 수 있는지(WP-1280) — 조회되면 true, 사용량 API 가 없으면(404 — metrics-server 미설치) false,
    // 그 밖의 실패는 일시 오류라 모름(undefined, 보내지 않아 Works 가 마지막 값을 둔다). 어느 쪽이든 사용량 없이 보고는 나간다.
    let metricsAvailable: boolean | undefined;
    try {
      usage = await this.cluster.podMetrics();
      metricsAvailable = true;
    } catch (e) {
      if (e instanceof ClusterError && e.status === 404) metricsAvailable = false;
    }

    const desiredIds = new Set(desired.agents.map((a) => a.agentUserId));
    const report = (id: number, stopping: boolean): RunnerObservedAgent => {
      const name = podName(id);
      const pod = podsByName.get(name);
      const state = toObserved(pod, stopping);
      const failure = stopping ? undefined : this.failures.get(id);
      const u = pod ? usage.get(name) : undefined;
      return {
        agentUserId: id,
        ...state,
        ...(failure ? { phase: 'FAILED' as const, message: clip(failure) } : {}),
        cpuMillicores: u?.cpuMillicores ?? null,
        memoryBytes: u?.memoryBytes ?? null,
      };
    };
    const agents = [
      ...desired.agents.map((a) => report(a.agentUserId, false)),
      ...actual.filter((a) => !desiredIds.has(a.agentUserId)).map((a) => report(a.agentUserId, true)),
    ];

    if (agents.length === 0) {
      await this.works.reportObserved([], metricsAvailable);
      return;
    }
    for (let i = 0; i < agents.length; i += OBSERVED_BATCH) {
      await this.works.reportObserved(agents.slice(i, i + OBSERVED_BATCH), metricsAvailable);
    }
  }
}

export interface LoopTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * 조정은 한 번에 하나만 돈다. 트리거(시작·SSE 이벤트·주기·재시도)가 도는 중에 오면 하나로 합쳐 끝난 뒤 한 번 더 돈다.
 * 회차가 끝나면 다음 예약을 하나만 둔다 — 남은 일이 있으면 {@link RETRY_MS}(곧 5초·지우는 중 기다림 15초·거절 30초),
 * 없으면 desired 의 pollIntervalSeconds.
 */
export class ReconcileLoop {
  private running = false;
  private pending = false;
  private timer: unknown;
  private stopped = false;

  constructor(
    private readonly run: () => Promise<ReconcileResult>,
    private readonly log: Logger,
    private readonly timers: LoopTimers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    },
  ) {}

  /** 조정을 깨운다. 도는 중이면 끝난 뒤 한 번 더. 끝나면 돌려준 promise 가 풀린다(테스트용). */
  async trigger(): Promise<void> {
    if (this.stopped) return;
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    let nextMs = RETRY_ON_ERROR_MS;
    try {
      do {
        this.pending = false;
        try {
          const r = await this.run();
          nextMs = r.retry ? RETRY_MS[r.retry] : Math.max(1, r.pollIntervalSeconds) * 1000;
        } catch (e) {
          nextMs = RETRY_ON_ERROR_MS;
          this.log.error('조정 실패 — 다시 시도합니다', { error: errMessage(e), retryMs: nextMs });
        }
      } while (this.pending && !this.stopped);
    } finally {
      this.running = false;
    }
    this.schedule(nextMs);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      void this.trigger();
    }, ms);
  }

  stop() {
    this.stopped = true;
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
