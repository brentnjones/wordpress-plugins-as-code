# wordpress-plugins-as-code

Run WordPress in containers (Podman locally, OpenShift in production) where
plugins and themes are declared in `composer.json` and baked into the image
at build time instead of being managed by hand through wp-admin.

## How it works

- **`composer.json`** declares plugins/themes from [WPackagist](https://wpackagist.org)
  (the mirror of the official plugin/theme directories) as regular Composer
  dependencies, using `composer/installers` to place them under
  `wp-content/plugins/` and `wp-content/themes/`.
- **`docker/wordpress/Dockerfile`** is a two-stage build:
  1. `composer install` resolves the plugins/themes.
  2. They're copied into `/usr/src/wordpress/wp-content/...` on top of the
     official `wordpress:*-fpm-alpine` image. WordPress's own
     `docker-entrypoint.sh` already copies `/usr/src/wordpress` into
     `/var/www/html` on first boot (skipping anything that already exists),
     so no custom entrypoint is needed - the baked-in plugins just show up.
  3. The image is hardened to run as an arbitrary non-root UID in group 0
     (OpenShift's `restricted` SCC): group-writable files, and the php-fpm
     pool's `user`/`group` directives are stripped so the already-non-root
     master process doesn't try to `setuid`/`setgid`.
- **`docker/nginx/`** builds `nginxinc/nginx-unprivileged` (listens on 8080,
  no root required) with a templated config that proxies `*.php` to php-fpm
  over FastCGI (`FASTCGI_HOST:9000`).
- WordPress core files, plugins and themes live on an **ephemeral** shared
  volume (populated fresh from the image on every pod start) - this is what
  makes plugins "as code": to add/remove/update a plugin you edit
  `composer.json`, rebuild the image, and roll out. Only `wp-content/uploads`
  (user-uploaded media) is persistent, on its own PVC.

## Local development (Podman)

```bash
cp .env.example .env
# edit .env with real passwords
podman-compose up --build
# or: docker compose up --build
```

Visit http://localhost:8080 and complete the WordPress install wizard. The
plugins declared in `composer.json` will already be present under
Plugins → Installed Plugins (activate as needed).

To add a plugin: add it to `composer.json` (find slugs at
https://wpackagist.org), then:

```bash
podman-compose up --build wordpress
```

## OpenShift

Manifests are under `openshift/` (also usable via `oc apply -k openshift/`).

1. **Build the images in-cluster** using the provided `BuildConfig`s (edit the
   `git.uri` in `openshift/03-builds.yaml` to point at your fork/repo first),
   or build/push them yourself and update the `image:` references in
   `openshift/20-wordpress.yaml`.
2. **Create real secrets** - do not apply `openshift/01-secrets.yaml` as-is.
   Instead create them directly, e.g.:

   ```bash
   oc create secret generic mysql-credentials \
     --from-literal=MYSQL_DATABASE=wordpress \
     --from-literal=MYSQL_USER=wordpress \
     --from-literal=MYSQL_PASSWORD="$(openssl rand -base64 24)" \
     --from-literal=MYSQL_ROOT_PASSWORD="$(openssl rand -base64 24)" \
     -n wordpress-plugins-as-code

   oc create secret generic wordpress-db-credentials \
     --from-literal=WORDPRESS_DB_NAME=wordpress \
     --from-literal=WORDPRESS_DB_USER=wordpress \
     --from-literal=WORDPRESS_DB_PASSWORD="$(same password as above)" \
     -n wordpress-plugins-as-code
   ```

3. Apply everything else:

   ```bash
   oc new-project wordpress-plugins-as-code   # or apply 00-namespace.yaml
   oc apply -k openshift/
   oc start-build wordpress-custom -n wordpress-plugins-as-code --follow
   oc start-build wordpress-nginx -n wordpress-plugins-as-code --follow
   oc rollout restart deployment/wordpress -n wordpress-plugins-as-code
   ```

4. Get the route: `oc get route wordpress -n wordpress-plugins-as-code`

### Building/deploying with OpenShift Pipelines (Tekton)

As an alternative to `oc start-build` + `oc rollout restart`, `pipelines/`
defines a Tekton `Pipeline` that clones this repo, runs a SonarQube quality
gate, builds and pushes both images with the cluster's `buildah` task (only
if the gate passes), then rolls out the `wordpress` Deployment - requires
the OpenShift Pipelines operator.

**One-time setup - SonarQube server:**

```bash
oc apply -f pipelines/02-sonarqube-server.yaml -n wordpress-plugins-as-code
oc rollout status deployment/sonarqube -n wordpress-plugins-as-code

# Change the default admin/admin password (required before the API is usable):
POD=$(oc get pods -n wordpress-plugins-as-code -l app=sonarqube -o jsonpath='{.items[0].metadata.name}')
oc exec "$POD" -n wordpress-plugins-as-code -- curl -s -u admin:admin -X POST \
  http://localhost:9000/api/users/change_password \
  --data-urlencode "login=admin" --data-urlencode "previousPassword=admin" \
  --data-urlencode "password=<a-strong-password-with-a-special-char>"

# Generate a token for the pipeline and store it as a Secret:
oc exec "$POD" -n wordpress-plugins-as-code -- curl -s -u "admin:<the-password-above>" -X POST \
  http://localhost:9000/api/user_tokens/generate --data-urlencode "name=tekton-pipeline"
# copy the "token" value from the response, then:
oc create secret generic sonarqube-token -n wordpress-plugins-as-code --from-literal=SONAR_TOKEN=<token>
```

**Build/deploy pipeline:**

```bash
oc apply -f pipelines/00-rbac.yaml -f pipelines/sonar-scanner-task.yaml -f pipelines/pipeline.yaml -n wordpress-plugins-as-code
oc create -f pipelines/pipelinerun-example.yaml -n wordpress-plugins-as-code
tkn pipelinerun logs -n wordpress-plugins-as-code --last -f
```

Or trigger a run with overridden params via the `tkn` CLI, e.g. a different
branch/tag:

```bash
tkn pipeline start wordpress-plugins-as-code -n wordpress-plugins-as-code \
  --param git-revision=my-branch \
  --workspace name=shared-workspace,volumeClaimTemplateFile=<(echo 'spec: {accessModes: [ReadWriteOnce], resources: {requests: {storage: 1Gi}}}') \
  --use-param-defaults --showlog
```

The SonarQube server ([pipelines/02-sonarqube-server.yaml](pipelines/02-sonarqube-server.yaml))
uses Community Edition with its bundled H2 database - fine for gating this
pipeline, not intended as a production-grade SonarQube deployment (no HA,
no backups, embedded DB is eval-only per SonarSource).

### Auto-triggering the pipeline on commit (Pipelines-as-Code)

Instead of manually creating a `PipelineRun`, [pipelines/pac-repository.yaml](pipelines/pac-repository.yaml)
+ [.tekton/push.yaml](.tekton/push.yaml) wire up OpenShift Pipelines-as-Code
(PAC) so a push to `main` on GitHub automatically runs the same pipeline
(sonar-scan -> build -> rollout) via a webhook - no ArgoCD involved, PAC is
the native trigger mechanism for this.

`.tekton/push.yaml` just references the existing in-cluster `Pipeline`
(`pipelines/pipeline.yaml`) via `pipelineRef` rather than redefining it, so
there's one source of truth for the pipeline's steps.

One-time setup (needs your own GitHub token/webhook, not something we can
script from here):

1. Create a GitHub personal access token for `brentnjones` with `repo` scope
   (classic) or, for a fine-grained token, `Contents: Read`,
   `Commit statuses: Read and write`, `Pull requests: Read and write` on
   this repo - used by PAC to report check results back to GitHub.
2. Create the secret PAC/the Repository CR expect (run this yourself so the
   token never has to be shared/pasted anywhere else):

   ```bash
   WEBHOOK_SECRET=$(openssl rand -hex 20)
   oc create secret generic pac-github-webhook-secret -n wordpress-plugins-as-code \
     --from-literal=webhook.secret="$WEBHOOK_SECRET" \
     --from-literal=provider.token="<your-github-token>"
   echo "Webhook secret (use in step 3): $WEBHOOK_SECRET"
   ```

3. On GitHub -> repo Settings -> Webhooks -> Add webhook:
   - Payload URL: the PAC controller route -
     `oc get route pipelines-as-code-controller -n openshift-pipelines -o jsonpath='{.spec.host}'`
     (prefix with `https://`)
   - Content type: `application/json`
   - Secret: the `WEBHOOK_SECRET` value printed above
   - Events: just the `push` event
4. Apply the Repository CR (safe to re-apply, no secrets in it):
   `oc apply -f pipelines/pac-repository.yaml -n wordpress-plugins-as-code`

After that, every push to `main` creates a new `PipelineRun` automatically -
watch it with `tkn pipelinerun logs -n wordpress-plugins-as-code --last -f`
or `oc get pipelinerun -n wordpress-plugins-as-code`.

### Pod layout

Each WordPress pod runs three containers sharing an `emptyDir` document root:

- `init-wordpress` (init container): populates the document root from the
  image (core + baked-in plugins/themes) and writes `wp-config.php` from the
  DB secret, then exits.
- `wordpress`: php-fpm, listening on 9000 (loopback only within the pod).
- `nginx`: serves static files and proxies `.php` requests to php-fpm on
  `127.0.0.1:9000`; mounts the document root read-only.

`wp-content/uploads` is a separate `ReadWriteOnce` PVC mounted into all three
so uploaded media survives restarts/rollouts.

### Plugin management is locked out of wp-admin

`WORDPRESS_CONFIG_EXTRA` (set in `.env.example` and `openshift/01-secrets.yaml`)
defines `DISALLOW_FILE_MODS` and `DISALLOW_FILE_EDIT`, which removes the
Plugins/Themes install-update-delete screens and the file editor from
wp-admin entirely. This is deliberate: the document root is an ephemeral
volume repopulated from the image on every pod (re)start, so anything
installed through wp-admin would appear to work and then silently vanish on
the next rollout. `composer.json` is the only supported way to add/remove
plugins/themes.

### Notes / things you'll likely want to change

- Pin the WordPress/PHP version in `docker/wordpress/Dockerfile` deliberately
  rather than relying on a moving tag.
- Add auth key & salt env vars (generate at
  https://api.wordpress.org/secret-key/1.1/salt/) to the `wordpress-db-credentials`
  secret for production.
- If you need `ReadWriteMany` for multiple WordPress replicas sharing uploads,
  swap the `wordpress-uploads` PVC's storage class/access mode accordingly.
- Consider a one-shot `Job` running `wp core install`/`wp plugin activate`
  (via `wp-cli`) for fully unattended provisioning after first deploy.
