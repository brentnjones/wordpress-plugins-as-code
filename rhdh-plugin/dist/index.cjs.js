'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var backendPluginApi = require('@backstage/backend-plugin-api');
var pluginScaffolderNode = require('@backstage/plugin-scaffolder-node');
var k8s = require('@kubernetes/client-node');

function _interopNamespaceCompat(e) {
  if (e && typeof e === 'object' && 'default' in e) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var k8s__namespace = /*#__PURE__*/_interopNamespaceCompat(k8s);

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
    const kubeConfig = new k8s__namespace.KubeConfig();
    kubeConfig.loadFromCluster();
    const customObjects = kubeConfig.makeApiClient(k8s__namespace.CustomObjectsApi);
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
    const response = await customObjects.createNamespacedCustomObject({
      group: "tekton.dev",
      version: "v1",
      namespace: input.namespace,
      plural: "pipelineruns",
      body: pipelineRun
    });
    const created = response.body;
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
