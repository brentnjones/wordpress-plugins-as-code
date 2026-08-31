import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import {
  createTemplateAction,
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';
import * as k8s from '@kubernetes/client-node';

const createPipelineRunAction = () =>
  createTemplateAction({
    id: 'openshift:pipeline-run',
    description: 'Create a Tekton PipelineRun in the pipeline namespace.',
    schema: {
      input: z => z.object({
        namespace: z.string().min(1),
        generateName: z.string().min(1),
        pipelineName: z.string().min(1),
        serviceAccountName: z.string().min(1),
        params: z.record(z.string()),
        registrySecretName: z.string().min(1),
      }),
      output: z => z.object({
        pipelineRunName: z.string(),
      }),
    },
    async handler(ctx) {
      const kubeConfig = new k8s.KubeConfig();
      const serviceAccountPath = '/var/run/secrets/kubernetes.io/serviceaccount';
      const server = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? '443'}`;
      kubeConfig.loadFromOptions({
        clusters: [{
          name: 'inCluster',
          server,
          caFile: `${serviceAccountPath}/ca.crt`,
        }],
        users: [{
          name: 'inClusterUser',
          authProvider: {
            name: 'tokenFile',
            config: { tokenFile: `${serviceAccountPath}/token` },
          },
        }],
        contexts: [{
          name: 'inClusterContext',
          cluster: 'inCluster',
          user: 'inClusterUser',
        }],
        currentContext: 'inClusterContext',
      });
      const customObjects = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
      const input = ctx.input;
      const pipelineRun: Record<string, unknown> = {
        apiVersion: 'tekton.dev/v1',
        kind: 'PipelineRun',
        metadata: {
          generateName: input.generateName,
          namespace: input.namespace,
        },
        spec: {
          pipelineRef: { name: input.pipelineName },
          taskRunTemplate: { serviceAccountName: input.serviceAccountName },
          params: Object.entries(input.params).map(([name, value]) => ({ name, value })),
          workspaces: [
            {
              name: 'shared-workspace',
              volumeClaimTemplate: {
                spec: {
                  accessModes: ['ReadWriteOnce'],
                  resources: { requests: { storage: '1Gi' } },
                },
              },
            },
            {
              name: 'quay-auth',
              secret: { secretName: input.registrySecretName },
            },
          ],
        },
      };

      const response = await customObjects.createNamespacedCustomObject({
        group: 'tekton.dev',
        version: 'v1',
        namespace: input.namespace,
        plural: 'pipelineruns',
        body: pipelineRun,
      });
      const created = response.body as { metadata?: { name?: string } };
      const pipelineRunName = created.metadata?.name;
      if (!pipelineRunName) {
        throw new Error('OpenShift did not return the created PipelineRun name');
      }
      ctx.output('pipelineRunName', pipelineRunName);
      ctx.logger.info(`Created PipelineRun ${pipelineRunName} in ${input.namespace}`);
    },
  });

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'openshift-pipeline-run',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        logger: coreServices.logger,
      },
      async init({ scaffolder, logger }) {
        scaffolder.addActions(createPipelineRunAction());
        logger.info('Registered openshift:pipeline-run scaffolder action');
      },
    });
  },
});
