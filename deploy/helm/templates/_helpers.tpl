{{/* 공통 라벨 */}}
{{- define "swp.labels" -}}
app.kubernetes.io/part-of: smart-workplace
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* 컴포넌트별 selector 라벨 */}}
{{- define "swp.selectorLabels" -}}
app: {{ .component }}
app.kubernetes.io/part-of: smart-workplace
{{- end -}}

{{/*
무중단 롤링 전략 — 새 파드가 Ready 가 된 뒤에 기존 파드를 내린다(maxUnavailable 0).
replicas 1 에서 기본값(25%/25%)도 결과는 같지만, 비율 반올림에 기대지 않도록 명시한다(WP-164).
Recreate 는 문서 상태를 메모리에 들고 있는 collab 하나뿐이다 — ai-agent 도 WP-167 에서 롤링으로 전환됐다.
*/}}
{{- define "swp.rollingStrategy" -}}
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: {{ .Values.rollout.maxSurge }}
    maxUnavailable: {{ .Values.rollout.maxUnavailable }}
{{- end -}}

{{/*
종료 직전 요청 보호 — SIGTERM 과 Service Endpoint 제거는 동시에 진행돼, 종료 중인 파드로
ingress/kube-proxy 가 몇 초간 요청을 더 보낸다. preStop 에서 잠시 기다려 Endpoint 제거가 전파된 뒤
앱이 종료를 시작하게 한다. sleep 액션(k8s 1.30+)은 컨테이너 안 바이너리가 필요 없어 distroless api 에도 쓸 수 있다.
*/}}
{{- define "swp.preStop" -}}
lifecycle:
  preStop:
    sleep:
      seconds: {{ .Values.rollout.preStopSleepSeconds }}
{{- end -}}

{{/*
앱 이미지 참조 — 릴리스 매니페스트가 주입한 `images.<앱 id>` 의 repository@digest 로만 렌더한다(WP-438).
태그를 쓰지 않는 이유: 이전 릴리스에서 승계한 앱은 digest 가 그대로라 pod spec 이 바뀌지 않아 재기동되지 않고,
helm rollback 이 정확히 그 이미지로 돌아간다. 값이 없거나 digest 형식이 아니면 렌더를 실패시켜 :latest 로 새지 않게 한다.
사용: {{ include "swp.image" (dict "root" $ "id" "api") }}
*/}}
{{- define "swp.image" -}}
{{- $img := index (.root.Values.images | default dict) .id | default dict -}}
{{- $repo := required (printf "images.%s.repository 값이 필요합니다 (릴리스 매니페스트에서 주입)" .id) $img.repository -}}
{{- $digest := $img.digest | default "" -}}
{{- if not (regexMatch "^sha256:[0-9a-f]{64}$" $digest) -}}
{{- fail (printf "images.%s.digest 가 sha256:<64자 hex> 형식이 아닙니다: %q" .id $digest) -}}
{{- end -}}
{{- printf "%s@%s" $repo $digest -}}
{{- end -}}

{{/*
앱별 복제 수(WP-1971) — 여섯 앱 Deployment 의 spec.replicas 값. 출력은 정수 문자열("0"·"2" 등).
id 는 values 키(api·aiAgent·web·admin·mcp·worker)이며 이미지 카탈로그 id(ai-agent)와는 다르다.
판정 규칙: ① <id>.replicas 값이 정수 형식이 아니면 렌더 실패, ② appReplicas 가 0 이면 어느 앱이든 0
(신규 클러스터 이관용 동결 값 — 앱별 값이 있어도 이긴다), ③ 그 밖에는 <id>.replicas 있으면 그 값, 없으면 appReplicas.
사용: {{ include "swp.replicas" (dict "root" $ "id" "web") }}
*/}}
{{- define "swp.replicas" -}}
{{- $root := .root -}}
{{- /* appReplicas 의 정수 검사는 swp.dbConnectionBudget(=validate.yaml) 가 책임진다 — 그 검사가 빠지면 여기서 0 으로 읽혀 모든 앱이 동결된다 */ -}}
{{- $fallback := int $root.Values.appReplicas -}}
{{- $app := index $root.Values .id | default dict -}}
{{- if not (kindIs "map" $app) -}}{{- fail (printf "%s 는 값 단위여야 합니다" .id) -}}{{- end -}}
{{- if hasKey $app "replicas" -}}
{{- $raw := get $app "replicas" -}}
{{- if not (regexMatch "^[0-9]+$" (toString $raw)) -}}
{{- fail (printf "%s.replicas 는 정수여야 합니다(현재 값: %v)" .id $raw) -}}
{{- end -}}
{{- if eq $fallback 0 -}}{{- 0 -}}{{- else -}}{{- int $raw -}}{{- end -}}
{{- else -}}
{{- $fallback -}}
{{- end -}}
{{- end -}}

{{/*
노드 분산 배치(WP-1971) — effective 복제 수가 2 이상일 때만, 파드가 한 노드에 몰리지 않게 스케줄을 흩어 놓는다.
whenUnsatisfiable 는 ScheduleAnyway 로 고정한다 — 노드가 한 대뿐인 환경에서도 스케줄을 거부해 파드가 뜨지 않게 하지 않는다.
id 는 values 키(api·aiAgent·web·admin·mcp·worker), name 은 Deployment·PDB 이름과 같은 app 라벨 값 —
둘은 보통 같지만 aiAgent 와 ai-agent 만 다르므로 하나로 합치지 않는다.
사용: {{- with include "swp.spread" (dict "root" $ "id" "web" "name" "web") }}{{ . | nindent 6 }}{{- end }}
  (with 로 감싸는 이유: 빈 출력에 `| nindent 6` 을 단 채로 두면 "\n"+들여쓰기만 남아 pod spec 에
   공백 전용 줄이 하나 더 생기고, 기본값 렌더가 이전과 바이트까지 달라진다 — 완료 조건 2)
*/}}
{{- define "swp.spread" -}}
{{- if ge (int (include "swp.replicas" (dict "root" .root "id" .id))) 2 -}}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: {{ .name }}
{{- end -}}
{{- end -}}

{{/* private 레지스트리(Docker Hub) pull 자격 — 모든 파드 spec 에 넣는다. Secret 은 Helm 밖에서 만든다(README). */}}
{{- define "swp.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/*
DB 커넥션 합계 가드(WP-1972) — 출력은 없고, 합계가 db.maxConnections 를 넘으면 렌더를 실패시킨다.
파드 수는 api 복제 수(값 키 api.replicas, 없으면 appReplicas) 로 센다(WP-1971).
파드마다 Hikari 풀이 따로라 접속 수 = 파드 수 × 풀 크기이다. 롤링 중엔 새 파드가 maxSurge 대 더 뜨고,
옛 파드는 preStop 10s + graceful 최대 30s 동안 풀을 쥔 채 종료 중인데 Deployment 컨트롤러는 종료 중 파드를
maxSurge 에 세지 않아 다음 새 파드가 함께 뜬다 — 그래서 maxSurge 를 두 번(새 파드 몫 + 종료 중인 옛 파드 몫) 센다.
대수만 늘리고 max_connections 를 안 올리면 운영에서 풀 고갈(WP-752)이 나므로 배포 전에 막는다.
Flyway 는 기동 중인 새 파드가 기동 때만 2 개씩 붙으므로 그 몫(maxSurge × 2)을 식에 넣는다 — maxSurge 를 올리면 같이 늘어난다.
식: (api 복제 수 + rollout.maxSurge × 2) × api.dbPoolMaxSize + rollout.maxSurge × 2 + db.reservedConnections <= db.maxConnections
*/}}
{{- define "swp.dbConnectionBudget" -}}
{{- /* "50%"·"20x" 같은 값은 int 변환이 0 으로 읽어 합계를 적게 세므로 정수가 아니면 거절한다("1" 같은 숫자 문자열은 허용) */ -}}
{{- range $k, $v := dict "rollout.maxSurge" .Values.rollout.maxSurge "appReplicas" .Values.appReplicas "api.dbPoolMaxSize" .Values.api.dbPoolMaxSize "db.maxConnections" .Values.db.maxConnections "db.reservedConnections" .Values.db.reservedConnections -}}
{{- if not (regexMatch "^[0-9]+$" (toString $v)) -}}
{{- fail (printf "%s 는 DB 커넥션 합계 계산을 위해 정수여야 합니다(현재 값: %v)" $k $v) -}}
{{- end -}}
{{- end -}}
{{- /* Hikari 는 maximum-pool-size 가 1 미만이면 기본 10 을 쓴다 — 0 을 받으면 가드는 0 으로 세는데 파드마다 10 개를 열므로 1 이상만 받는다 */ -}}
{{- if lt (int .Values.api.dbPoolMaxSize) 1 -}}
{{- fail (printf "api.dbPoolMaxSize 는 1 이상이어야 합니다(현재 값: %v) — Hikari 는 1 미만이면 기본 10 을 씁니다" .Values.api.dbPoolMaxSize) -}}
{{- end -}}
{{- $replicas := int (include "swp.replicas" (dict "root" $ "id" "api")) -}}
{{- $surge := int .Values.rollout.maxSurge -}}
{{- $pool := int .Values.api.dbPoolMaxSize -}}
{{- $reserved := int .Values.db.reservedConnections -}}
{{- $max := int .Values.db.maxConnections -}}
{{- /* Flyway 몫: 새 파드(maxSurge 대)마다 기동 중 2 개 */ -}}
{{- $flyway := mul 2 $surge -}}
{{- $total := add (mul (add $replicas (mul 2 $surge)) $pool) $flyway $reserved -}}
{{- if gt $total $max -}}
{{- fail (printf "DB 커넥션 합계 %d > db.maxConnections %d: (api 복제 수 %d + rollout.maxSurge %d × 2) × api.dbPoolMaxSize %d + Flyway %d + db.reservedConnections %d. 대수·풀을 줄이거나 db.maxConnections 를 올리세요(docs/ops/multi-instance.md)" $total $max $replicas $surge $pool $flyway $reserved) -}}
{{- end -}}
{{- end -}}
