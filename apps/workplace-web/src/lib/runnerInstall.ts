// runner 설치 순서(WP-1256) — deploy/helm-agent-runner/README.md 「설치 순서」와 같은 명령. 토큰 원문은 명령에 넣지 않는다
// (셸 기록·프로세스 목록에 남는다) — 파일로 저장한 뒤 --set-file 로 넘긴다. README 를 바꾸면 여기도 함께 바꾼다.

export interface RunnerInstallStep {
  title: string;
  command: string;
  note?: string;
}

/** IPv4 점 네 칸(각 0~255, 앞자리 0 없음) — 설치 대화상자의 내부 IP 칸 검증. 쿠버네티스는 010 같은 앞자리 0 을 거절한다. */
export function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255);
}

/** metrics-server 매니페스트(PoC 에 설치해 확인한 v0.7.2) — README 「CPU·메모리 사용량」과 같은 주소. */
export const METRICS_SERVER_MANIFEST = 'https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml';

/** 「설치 대기」가 오래 갈 때 볼 것 — runner 로그에 fetch failed 가 반복되면 이 클러스터에서 Works 주소에 닿지 못하는 것이다. */
export const RUNNER_LOGS_COMMAND = 'kubectl --context <ctx> -n <ns> logs deploy/agent-runner --tail=50';

/**
 * @param worksUrl Works origin(예 https://genia-works.iacloud.kr) — runner 가 https 로 닿을 주소
 * @param version runner 이미지 태그 — 릴리스 버전(로컬 빌드 'dev' 면 자리표시)
 * @param internalIp Works 에 내부 IP 로 닿아야 하는 클러스터면 그 IP — runner·AI Pod 의 hostAliases 로 들어간다(WP-1269). 비거나 IPv4 가 아니면 지금 명령 그대로.
 */
export function runnerInstallSteps(worksUrl: string, version: string, internalIp = ''): RunnerInstallStep[] {
  const tag = version === 'dev' ? '<릴리스 버전>' : version;
  // 쓰는 도중이거나 잘못된 값이면 넣지 않는다 — 지금 명령 그대로.
  const ip = isIpv4(internalIp.trim()) ? internalIp.trim() : '';
  // 대괄호는 zsh 가 glob 으로 읽어 「no matches found」가 나므로 따옴표로 감싼다.
  const hostAliases = ip
    ? [`  --set 'hostAliases[0].ip=${ip}' \\`, `  --set 'hostAliases[0].hostnames[0]=${new URL(worksUrl).hostname}' \\`]
    : [];
  return [
    {
      title: '네임스페이스를 만들고 privileged 라벨을 붙입니다',
      command: [
        'kubectl --context <ctx> create namespace <ns>',
        'kubectl --context <ctx> label ns <ns> pod-security.kubernetes.io/enforce=privileged',
      ].join('\n'),
      note: 'AI 작업 공간의 docker 가 privileged 로 돌아서 필요합니다.',
    },
    {
      title: '이미지 pull secret 을 만듭니다',
      command: [
        'kubectl --context <ctx> -n <ns> create secret docker-registry dockerhub-pull \\',
        '  --docker-server=https://index.docker.io/v1/ --docker-username=<계정> --docker-password="$(cat ./dockerhub-token.txt)"',
      ].join('\n'),
    },
    {
      title: '위 토큰을 runner-token.txt 로 저장하고 설치합니다',
      command: [
        'helm --kube-context <ctx> install agent-runner deploy/helm-agent-runner -n <ns> \\',
        `  --set works.url=${worksUrl} \\`,
        `  --set image.tag=${tag} \\`,
        ...hostAliases,
        '  --set-file runnerToken=./runner-token.txt',
      ].join('\n'),
      note:
        '차트는 저장소의 deploy/helm-agent-runner 입니다. AI 작업 폴더는 AI 가 뜬 노드의 /var/lib/genia-agents 아래에 생깁니다. ' +
        '설치하고 1분쯤 지나면 이 화면에서 「연결됨」으로 바뀝니다.',
    },
    {
      // WP-1280 — 없으면 AI 상태의 CPU·메모리가 「알 수 없음」으로 보인다. 클러스터 전체에 한 번 깔며 이미 있으면 건너뛴다.
      title: '(선택) CPU·메모리 사용량을 보려면 metrics-server 를 설치합니다',
      command: `kubectl --context <ctx> apply -f ${METRICS_SERVER_MANIFEST}`,
      note: '클러스터에 이미 있으면 건너뜁니다. 클러스터 전체에 한 번만 설치하며 약 0.1코어·200Mi 를 예약합니다. 없으면 AI 상태의 CPU·메모리가 「알 수 없음」으로 보입니다.',
    },
  ];
}
