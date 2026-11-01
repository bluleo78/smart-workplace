{{/* 리소스 이름 — 릴리스 이름을 그대로 쓴다(위치마다 네임스페이스가 달라 겹치지 않는다) */}}
{{- define "runner.name" -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "runner.selectorLabels" -}}
app.kubernetes.io/name: agent-runner
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "runner.labels" -}}
{{ include "runner.selectorLabels" . }}
app.kubernetes.io/part-of: smart-workplace
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* runner 토큰 Secret 이름 — existingSecret 이 있으면 그것, 없으면 차트가 만든 것 */}}
{{- define "runner.tokenSecret" -}}
{{- if .Values.existingSecret -}}{{ .Values.existingSecret }}{{- else -}}{{ include "runner.name" . }}-token{{- end -}}
{{- end -}}

{{/* imagePullSecrets 의 이름들을 쉼표로 — runner 가 AI Pod 에 같은 pull secret 을 붙인다. */}}
{{- define "runner.pullSecretNames" -}}
{{- $names := list -}}
{{- range .Values.imagePullSecrets -}}{{- $names = append $names .name -}}{{- end -}}
{{- join "," $names -}}
{{- end }}
