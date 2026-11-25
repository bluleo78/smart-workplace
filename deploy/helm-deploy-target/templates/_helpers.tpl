{{/* 대상 네임스페이스 — 비우면 렌더를 멈춘다 */}}
{{- define "deployTarget.namespace" -}}
{{- required "targetNamespace 가 필요합니다 (배포할 앱의 네임스페이스)" .Values.targetNamespace -}}
{{- end -}}

{{/* ServiceAccount 이름 — 비우면 deploy-<targetNamespace> */}}
{{- define "deployTarget.saName" -}}
{{- .Values.serviceAccount.name | default (printf "deploy-%s" (include "deployTarget.namespace" .)) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Role·바인딩 이름 — 같은 SA 가 여러 앱을 맡아도 앱 네임스페이스마다 따로라 겹치지 않는다 */}}
{{- define "deployTarget.roleName" -}}
{{- include "deployTarget.saName" . -}}
{{- end -}}

{{- define "deployTarget.labels" -}}
app.kubernetes.io/name: deploy-target
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: smart-workplace
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
genia.works/deploy-target: {{ include "deployTarget.namespace" . }}
{{- end -}}

{{/* 바인딩의 subject — AI Pod 네임스페이스의 ServiceAccount */}}
{{- define "deployTarget.subject" -}}
- kind: ServiceAccount
  name: {{ include "deployTarget.saName" . }}
  namespace: {{ .Values.serviceAccount.namespace }}
{{- end -}}
