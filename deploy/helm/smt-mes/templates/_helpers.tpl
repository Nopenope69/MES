{{/*
Expand the name of the chart.
*/}}
{{- define "smt-mes.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "smt-mes.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "smt-mes.labels" -}}
helm.sh/chart: {{ include "smt-mes.name" . }}-{{ .Chart.Version | replace "+" "_" }}
{{ include "smt-mes.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
factory.mes.io/site: {{ .Values.global.factorySite | quote }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "smt-mes.selectorLabels" -}}
app.kubernetes.io/name: {{ include "smt-mes.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API Selector labels
*/}}
{{- define "smt-mes.apiSelectorLabels" -}}
app.kubernetes.io/name: {{ include "smt-mes.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Web Selector labels
*/}}
{{- define "smt-mes.webSelectorLabels" -}}
app.kubernetes.io/name: {{ include "smt-mes.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: web
{{- end }}
