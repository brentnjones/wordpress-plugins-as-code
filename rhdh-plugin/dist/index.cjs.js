'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var fs = require('node:fs');
var https = require('node:https');
var backendPluginApi = require('@backstage/backend-plugin-api');
var pluginScaffolderNode = require('@backstage/plugin-scaffolder-node');

function _interopDefaultCompat (e) { return e && typeof e === 'object' && 'default' in e ? e : { default: e }; }

var fs__default = /*#__PURE__*/_interopDefaultCompat(fs);
var https__default = /*#__PURE__*/_interopDefaultCompat(https);

const createPipelineRun = (namespace, pipelineRun) => new Promise((resolve, reject) => {
  const body = JSON.stringify(pipelineRun);
  const request = https__default.default.request({
    hostname: process.env.KUBERNETES_SERVICE_HOST,
    port: process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? "443",
    path: `/apis/tekton.dev/v1/namespaces/${namespace}/pipelineruns`,
    method: "POST",
    rejectUnauthorized: false,
    headers: {
      Authorization: `Bearer ${fs__default.default.readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token", "utf8").trim()}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    }
  }, (response) => {
    let responseBody = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      responseBody += chunk;
    });
    response.on("end", () => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve(JSON.parse(responseBody));
      } else {
        reject(new Error(`OpenShift API returned ${response.statusCode}: ${responseBody}`));
      }
    });
  });
  request.on("error", reject);
  request.write(body);
  request.end();
});
const createPipelineRunAction = () => pluginScaffolderNode.createTemplateAction({
  id: "openshift:pipeline-run",
  description: "Create a Tekton PipelineRun in the pipeline namespace.",
  schema: {
    input: (z) => z.object({
      namespace: z.string().min(1),
      generateName: z.string().min(1),
      pipelineName: z.string().min(1),
      serviceAccountName: z.string().min(1),
      params: z.record(z.string()),
      registrySecretName: z.string().min(1)
    }),
    output: (z) => z.object({
      pipelineRunName: z.string()
    })
  },
  async handler(ctx) {
    const input = ctx.input;
    const pipelineRun = {
      apiVersion: "tekton.dev/v1",
      kind: "PipelineRun",
      metadata: {
        generateName: input.generateName,
        namespace: input.namespace
      },
      spec: {
        pipelineRef: { name: input.pipelineName },
        taskRunTemplate: { serviceAccountName: input.serviceAccountName },
        params: Object.entries(input.params).map(([name, value]) => ({ name, value })),
        workspaces: [
          {
            name: "shared-workspace",
            volumeClaimTemplate: {
              spec: {
                accessModes: ["ReadWriteOnce"],
                resources: { requests: { storage: "1Gi" } }
              }
            }
          },
          {
            name: "quay-auth",
            secret: { secretName: input.registrySecretName }
          }
        ]
      }
    };
    const created = await createPipelineRun(input.namespace, pipelineRun);
    const pipelineRunName = created.metadata?.name;
    if (!pipelineRunName) {
      throw new Error("OpenShift did not return the created PipelineRun name");
    }
    ctx.output("pipelineRunName", pipelineRunName);
    ctx.logger.info(`Created PipelineRun ${pipelineRunName} in ${input.namespace}`);
  }
});
var index = backendPluginApi.createBackendModule({
  pluginId: "scaffolder",
  moduleId: "openshift-pipeline-run",
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: pluginScaffolderNode.scaffolderActionsExtensionPoint,
        logger: backendPluginApi.coreServices.logger
      },
      async init({ scaffolder, logger }) {
        scaffolder.addActions(createPipelineRunAction());
        logger.info("Registered openshift:pipeline-run scaffolder action");
      }
    });
  }
});

exports.default = index;
//# sourceMappingURL=index.cjs.js.map
