# smart-workplace Helm 차트

운영(prod, kubecontext `iacloud-prod-public`, namespace `smart-workplace`) 배포 차트. 2026-10-17 `~/k8s/smart-workplace` 에서 옮겨 왔다(WP-438).

> **첫 릴리스 전환(WP-445) 전까지** 운영은 여전히 `~/k8s/smart-workplace` + `scripts/deploy.sh`(ghcr `:latest`)로 반영된다.
> 그 사이 차트를 바꿔야 하면 두 곳에 같이 반영하고, 전환 직전에 `helm get manifest` 와 이 차트 렌더를 다시 비교한다(아래 「렌더·검증」).
> 전환 뒤에는 이 차트만 쓰고 `~/k8s` 는 고치지 않는다.

- `values.yaml` 기본값 + `values.prod.yaml` 운영 오버라이드.
- 앱 이미지(`images.<앱 id>`)는 values 파일에 두지 않는다. 반영 도구(`deploy/release/release.mjs`, WP-443)가 릴리스 매니페스트의 `repository`·`digest` 를 주입하고, 값이 없으면 렌더가 실패한다. 도구 없이 반영해야 하면 `tests/images.fixture.yaml` 과 같은 모양의 values 파일에 실제 digest 를 적어 `-f` 로 넘긴다.
- 비밀값·pull 자격·TLS 는 차트가 만들지 않는다 — 아래 Secret 을 클러스터에 먼저 만든다.

## 클러스터에 미리 있어야 하는 Secret (Helm 밖)

| Secret | 종류 | 쓰는 곳 | 원본 백업 |
|---|---|---|---|
| `smart-workplace-secrets` (`existingSecret`) | generic | 앱 env(`envFrom`·`secretKeyRef`) | GitLab CI file 변수 `HELM_APP_SECRETS_ENV` |
| `dockerhub-pull` (`imagePullSecrets`) | docker-registry | 모든 파드의 이미지 pull | GitLab CI 변수 `DOCKERHUB_USERNAME`·`DOCKERHUB_TOKEN` |
| `genia-works-internal-tls` | tls | admin·mcp 내부 호스트(자체서명) | GitLab CI file 변수 `TLS_INTERNAL_CRT`·`TLS_INTERNAL_KEY` |
| `genia-works-tls` | tls | 공개 도메인 — cert-manager 가 발급·갱신 | 불필요 |

`smart-workplace-secrets` 가 담아야 하는 키는 `values.yaml` 의 `existingSecretKeys` 에 있다(템플릿은 쓰지 않는 문서용 목록 — 릴리스 체크리스트가 이 키들을 「이미 설정된 환경변수」로 본다). 키를 늘리거나 줄이면 그 목록도 함께 고친다.
`ENCRYPTION_MASTER_KEY` 는 이관해 온 값 그대로여야 한다(다르면 DB 암호화 컬럼·메일 첨부 캐시를 못 푼다).

```sh
NS="--context iacloud-prod-public -n smart-workplace"
# 비밀값 — KEY=VALUE 줄로 된 파일(HELM_APP_SECRETS_ENV 와 같은 내용)
kubectl $NS create secret generic smart-workplace-secrets --from-env-file=app-secrets.env
# Docker Hub pull — 읽기 권한 토큰
kubectl $NS create secret docker-registry dockerhub-pull \
  --docker-server=https://index.docker.io/v1/ --docker-username="$DOCKERHUB_USERNAME" --docker-password="$DOCKERHUB_TOKEN"
# 내부 호스트 TLS
kubectl $NS create secret tls genia-works-internal-tls --cert=swp-prod-internal.crt --key=swp-prod-internal.key
```

이미 있는 Secret 의 값을 바꿀 때는 `kubectl ... create secret ... --dry-run=client -o yaml | kubectl apply -f -` 로 덮고, 그 값을 읽는 앱을 `kubectl rollout restart` 한다(env 는 파드 시작 때만 읽힌다).

## Helm 이 만들던 Secret 을 넘겨받기 (첫 반영 한 번만)

전환 이전 리비전(values 에 `release.version` 이 없는 리비전)은 차트가 `smart-workplace-secrets` 를 만들었다. 이 차트로 처음 `helm upgrade` 하면 Helm 은 차트에서 빠진 Secret 을 **지운다** — 그 전에 아래를 실행해 둔다.

```sh
NS="--context iacloud-prod-public -n smart-workplace"
# 1) 업그레이드 때 지우지 않게 한다(Helm 은 지우기 직전 실제 객체의 이 주석을 본다)
kubectl $NS annotate secret smart-workplace-secrets helm.sh/resource-policy=keep
# 2) Helm 소유 표시를 뗀다 — 이후 Helm 과 무관한 Secret 이 된다
kubectl $NS annotate secret smart-workplace-secrets meta.helm.sh/release-name- meta.helm.sh/release-namespace-
kubectl $NS label secret smart-workplace-secrets app.kubernetes.io/managed-by- helm.sh/chart-
```

**전환 이전 리비전(values 에 `release.version` 이 없는 리비전)으로 `helm rollback` 하지 않는다.** 그 리비전들은 Secret 을 차트 값으로 들고 있어, rollback 이 클러스터 Secret 을 옛 값으로 덮거나 다시 Helm 소유로 가져갈 수 있다(이후 업그레이드에서 지워질 위험). 이미지도 `:latest` 라 되돌릴 대상이 정해지지 않는다. 되돌리기는 새 체계 릴리스끼리만 한다.

`release.mjs deploy` 는 매 실행 전에 이 인계 여부(Secret 의 `helm.sh/resource-policy: keep` 주석이 있고 `meta.helm.sh/release-name` 주석이 없는지)와 필수 Secret 존재를 읽기 전용으로 확인하고, 안 맞으면 반영하지 않는다.

이 절차는 운영 전에 임시 namespace 의 작은 차트로 한 번 리허설한다(Helm 4 에서 keep 주석·소유권 제거 뒤 upgrade 가 Secret 을 남기는지).

## 렌더·검증

```sh
# 렌더(이미지 값은 릴리스 매니페스트 대신 테스트 고정값)
helm template smart-workplace deploy/helm -n smart-workplace -f deploy/helm/values.prod.yaml -f deploy/helm/tests/images.fixture.yaml
# 차트 테스트 — digest 고정·pull secret·Secret 미생성·converter 연결·릴리스 정보가 파드에 안 들어가는지
node --test deploy/helm/tests/*.test.mjs
# 운영과 비교 — 기대 차이: 이미지(ghcr :latest → Docker Hub @digest)·IfNotPresent·imagePullSecrets·Secret 제외·converter·WORKPLACE_CONVERTER_URL·차트 라벨
helm --kube-context iacloud-prod-public get manifest smart-workplace -n smart-workplace
```

## 주의

- db 이미지 참조도 `images.db` 로 바뀌므로, ghcr 에서 Docker Hub 로 처음 넘어가는 반영 때 db 파드가 한 번 재시작된다(이후 db 가 바뀌지 않는 릴리스에서는 재시작 없음). StatefulSet 은 옛 파드를 먼저 내리므로, pull 이 실패하면 그동안 DB 가 내려가 있다 — **반영 전에** `dockerhub-pull` 로 모든 digest 를 클러스터 안에서 받아 보는 확인(임시 파드)을 한다.
- `--atomic` 을 쓰지 않는다 — 실패 시 자동 롤백이 Flyway 마이그레이션 뒤의 스키마와 어긋날 수 있어, 롤백은 사람이 판단해 `helm rollback` 한다.
