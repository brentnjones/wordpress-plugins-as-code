# Developer Hub OpenShift scaffolder action

Builds a Red Hat Developer Hub dynamic backend plugin that registers
`openshift:pipeline-run`. The action creates a Tekton PipelineRun through the
Kubernetes API, so it supports `metadata.generateName` without `oc apply`.
