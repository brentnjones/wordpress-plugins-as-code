"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var backend_plugin_api_1 = require("@backstage/backend-plugin-api");
var plugin_scaffolder_node_1 = require("@backstage/plugin-scaffolder-node");
var k8s = require("@kubernetes/client-node");
var createPipelineRunAction = function () {
    return (0, plugin_scaffolder_node_1.createTemplateAction)({
        id: 'openshift:pipeline-run',
        description: 'Create a Tekton PipelineRun in the pipeline namespace.',
        schema: {
            input: function (z) { return z.object({
                namespace: z.string().min(1),
                generateName: z.string().min(1),
                pipelineName: z.string().min(1),
                serviceAccountName: z.string().min(1),
                params: z.record(z.string()),
                registrySecretName: z.string().min(1),
            }); },
            output: function (z) { return z.object({
                pipelineRunName: z.string(),
            }); },
        },
        handler: function (ctx) {
            return __awaiter(this, void 0, void 0, function () {
                var kubeConfig, customObjects, input, pipelineRun, response, created, pipelineRunName;
                var _a;
                return __generator(this, function (_b) {
                    switch (_b.label) {
                        case 0:
                            kubeConfig = new k8s.KubeConfig();
                            kubeConfig.loadFromDefault();
                            customObjects = kubeConfig.makeApiClient(k8s.CustomObjectsApi);
                            input = ctx.input;
                            pipelineRun = {
                                apiVersion: 'tekton.dev/v1',
                                kind: 'PipelineRun',
                                metadata: {
                                    generateName: input.generateName,
                                    namespace: input.namespace,
                                },
                                spec: {
                                    pipelineRef: { name: input.pipelineName },
                                    taskRunTemplate: { serviceAccountName: input.serviceAccountName },
                                    params: Object.entries(input.params).map(function (_a) {
                                        var name = _a[0], value = _a[1];
                                        return ({ name: name, value: value });
                                    }),
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
                            return [4 /*yield*/, customObjects.createNamespacedCustomObject({
                                    group: 'tekton.dev',
                                    version: 'v1',
                                    namespace: input.namespace,
                                    plural: 'pipelineruns',
                                    body: pipelineRun,
                                })];
                        case 1:
                            response = _b.sent();
                            created = response.body;
                            pipelineRunName = (_a = created.metadata) === null || _a === void 0 ? void 0 : _a.name;
                            if (!pipelineRunName) {
                                throw new Error('OpenShift did not return the created PipelineRun name');
                            }
                            ctx.output('pipelineRunName', pipelineRunName);
                            ctx.logger.info("Created PipelineRun ".concat(pipelineRunName, " in ").concat(input.namespace));
                            return [2 /*return*/];
                    }
                });
            });
        },
    });
};
exports.default = (0, backend_plugin_api_1.createBackendModule)({
    pluginId: 'scaffolder',
    moduleId: 'openshift-pipeline-run',
    register: function (env) {
        env.registerInit({
            deps: {
                scaffolder: plugin_scaffolder_node_1.scaffolderActionsExtensionPoint,
                logger: backend_plugin_api_1.coreServices.logger,
            },
            init: function (_a) {
                return __awaiter(this, arguments, void 0, function (_b) {
                    var scaffolder = _b.scaffolder, logger = _b.logger;
                    return __generator(this, function (_c) {
                        scaffolder.addActions(createPipelineRunAction());
                        logger.info('Registered openshift:pipeline-run scaffolder action');
                        return [2 /*return*/];
                    });
                });
            },
        });
    },
});
