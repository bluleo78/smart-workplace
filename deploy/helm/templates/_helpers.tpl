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
RWO PVC 를 쓰는 ai-agent 는 Recreate 를 유지하므로 이 헬퍼를 쓰지 않는다(WP-167 에서 전환).
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

{{/* private 레지스트리(Docker Hub) pull 자격 — 모든 파드 spec 에 넣는다. Secret 은 Helm 밖에서 만든다(README). */}}
{{- define "swp.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
