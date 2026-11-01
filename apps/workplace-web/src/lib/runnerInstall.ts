// runner 설치 순서(WP-1256) — deploy/helm-agent-runner/README.md 「설치 순서」와 같은 명령. 토큰 원문은 명령에 넣지 않는다
// (셸 기록·프로세스 목록에 남는다) — 파일로 저장한 뒤 --set-file 로 넘긴다. README 를 바꾸면 여기도 함께 바꾼다.

export interface RunnerInstallStep {
  title: string;
  command: string;
  note?: string;
}

/**
 * @param worksUrl Works origin(예 https://genia-works.iacloud.kr) — runner 가 https 로 닿을 주소
 * @param version runner 이미지 태그 — 릴리스 버전(로컬 빌드 'dev' 면 자리표시)
 */
export function runnerInstallSteps(worksUrl: string, version: string): RunnerInstallStep[] {
  const tag = version === 'dev' ? '<릴리스 버전>' : version;
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
      title: 'GitHub 토큰 Secret 을 만듭니다',
      command: 'kubectl --context <ctx> -n <ns> create secret generic github-token --from-file=token=./github-token.txt',
      note: '대상 저장소의 Contents · Pull requests 쓰기 권한이 필요합니다.',
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
        '  --set github.existingSecret=github-token \\',
        '  --set-file runnerToken=./runner-token.txt',
      ].join('\n'),
      note: '차트는 저장소의 deploy/helm-agent-runner 입니다. 설치하고 1분쯤 지나면 이 화면에서 「연결됨」으로 바뀝니다.',
    },
  ];
}
