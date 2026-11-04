# Setup

**English** | [日本語](../setup.md)

This guide describes how to install Rolust into the account you deploy to.

There are two ways to get Rolust. **Path A** uses the Release tarball: you extract it, and you need neither `npm` nor a clone of the repository. **Path B** builds the source from the repository yourself, and needs Node.js and `npm`. The details are in "1. Get Rolust".

## Prerequisites

| What you need | Version / condition |
|---|---|
| Node.js | 24 or later (`engines` in `package.json`). **Not needed when you install from the Release tarball (Path A)** |
| npm | The one bundled with Node.js. Not needed on Path A |
| Terraform | **1.10 or later** (the state lock uses the S3 native lock, `use_lockfile`) |
| bash and jq | Used by `plan-guard.sh` (Git Bash on Windows). Needed on Path A too |
| An S3 bucket for the Terraform state | One. If you have none, `infra/bootstrap/` creates one (step 2) |
| AWS account | One account to deploy Rolust to. The IAM roles to be managed can be in the same account or in another account (the target; see [cross-account.md](cross-account.md)). It is fine if the deployment account has no managed roles |
| AWS credentials | They must be resolvable through the standard credential chain (`~/.aws/credentials`, `AWS_PROFILE`, SSO, and so on). **`terraform` does not take a profile as an argument the way `aws --profile` does.** Pass it with `export AWS_PROFILE=<profile> AWS_REGION=<region>`, and check with `aws sts get-caller-identity --profile <profile> --region <region>` that it resolves to the account you intend (see the start of step 2 and the note below) |

> **When `terraform` fails with `No valid credential sources found`**: the end of the message says something like `ec2imds: GetMetadata ... connectex`, but that is not the cause. The standard credential chain tried IMDS last and could not reach it. `terraform init` succeeds, so this is easy to miss, and it fails for the first time at `plan` or `apply`. Passing `AWS_PROFILE` / `AWS_REGION` above as environment variables fixes it (the `terraform` provider does not pin a profile).

**IAM permissions needed to apply**: the person running Terraform needs permission to create S3 / CloudFront / API Gateway / Lambda / DynamoDB / SSM / CloudWatch Logs resources, and also **permission to create IAM roles and policies**. Without permissions that include `iam:CreateRole` / `iam:PutRolePolicy` / `iam:PassRole`, `terraform apply` fails partway.

## 1. Get Rolust

There are two ways to get Rolust. **From step 2 on, both paths are the same.** In what follows, `infra/` and `.github/` are relative to the directory where you extracted the tarball on Path A, and to the repository root on Path B.

### A. From the Release tarball (for users; no `npm` and no repository clone needed)

1. On GitHub [Releases](https://github.com/kazuki-kudo/rolust/releases), download **`rolust-vX.Y.Z.tar.gz`** and **`SHA256SUMS`** of the version you want, into the same place. `gh release download vX.Y.Z --repo kazuki-kudo/rolust` also works.

   > **Do not take the "Source code" zip or tar.gz.** It is the source before the build, and it contains neither the Lambda bundles nor the SPA. If you take it, `terraform apply` fails. Use the `rolust-vX.Y.Z.tar.gz` that is **attached** to the Release.

2. Verify the checksum. Make sure it prints `OK`.

   ```bash
   sha256sum -c --ignore-missing SHA256SUMS      # => rolust-vX.Y.Z.tar.gz: OK
   ```

   `SHA256SUMS` and the tarball come from the same place. If the files stored there had been swapped, this check would not find it. Make sure you got them from GitHub Releases.

3. Extract it and move into the extracted directory.

   ```bash
   tar -xzf rolust-vX.Y.Z.tar.gz
   cd rolust-vX.Y.Z

   ```

### B. From the source (for developers)

```bash
npm install
npm run build

```

`npm run build` creates the following three things. `terraform apply` reads them, so **always run it before the apply**.

- `packages/api/dist/{crud,diff,apply}/index.js` — the Lambda bundles
- `packages/edge-auth/dist/index.js` — the Lambda@Edge bundle
- `packages/web/dist/` — the static files of the SPA

## 2. Decide where to keep the Terraform state

**First, pass your AWS credentials in this shell and check them.** `terraform` does not take a profile as an argument the way `aws --profile` does, so pass it with environment variables (read the note in "Prerequisites").

```bash
export AWS_PROFILE=<profile> AWS_REGION=<region>
aws sts get-caller-identity --query Account --output text    # Check that it is the account you intend

```

If you use SSO, run `aws sso login --profile <profile>` first. If you go on without checking, `terraform init` succeeds, and only the `apply` in step 2 (or the `plan` in step 4) fails with `No valid credential sources found`. **When you open a new shell, run the `export` again.**

The state is kept in S3. `terraform plan` decrypts SSM SecureString values and writes them into the state (see "Sensitive data ends up in the Terraform state" in [limitations.md](../limitations.md) (Japanese)), so you need an encrypted bucket.

**A. If you already have a usable S3 bucket**

```bash
cp infra/backend.hcl.example infra/backend.hcl
```

Open `infra/backend.hcl` in an editor and set the bucket and region to your own values (on Windows you can open it with `code infra/backend.hcl` or `notepad infra/backend.hcl`).

**B. If you have no bucket** — `infra/bootstrap/` creates one.

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply

# Generate backend.hcl from the output (do not copy it by hand)
terraform -chdir=infra/bootstrap output -raw backend_config_hcl > infra/backend.hcl

```

`infra/bootstrap/` **has no backend block and runs with a local state**. This is because the configuration that creates the state bucket cannot itself use that bucket (`terraform init` accesses the bucket right after reading the backend). It creates just one S3 bucket, and even if you lose the local state, you can import it again with `terraform import aws_s3_bucket.state <bucket name>`.

> **If you already have a bucket, do not run bootstrap.** It would create a second bucket that nobody uses.

## 3. Prepare the Terraform variables

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars

```

Open `terraform.tfvars` in an editor (on Windows you can open it with `code terraform.tfvars` or `notepad terraform.tfvars`).

**The lines commented out in the template (such as `# auth_mode = "basic"`) have the same values as the defaults in `infra/variables.tf`. Remove the `#` and rewrite the value only when you change it. If you do not remove it, the default is used.** Use the same values you uncommented in every later `terraform plan` and `terraform apply` (changing them produces a diff).

**The variables to decide before the apply are as follows.** You can change them later, but changing one means a second apply.

| Variable | What to decide |
|---|---|
| `pool_id` | **Required (there is no default).** The template's `"my-team"` is only an example, so rewrite it to your own identifier (see the note below) |
| `auth_mode` | The authentication method: `basic` (the default; Basic authentication with a single set of credentials) or `cognito` (several administrators sign in with their own credentials). **Decide before the apply.** If you switch later, every request can return 503 during the switch and for up to 5 minutes after it takes effect (the Lambda@Edge cache). The preparation in step 5 differs by method. The differences are in "Choosing an authentication method" in [access-control.md](access-control.md) |
| `managed_tag_key` / `managed_tag_value` | The tag that marks the roles Rolust can handle. The default is `rolust:managed` = `true` (see the note below) |
| `region` / `project_name` | The defaults are `ap-northeast-1` / `rolust`. If you do not change them, leave them as they are |

The other variables that are not commented out in the template (the table names, `basic_auth_parameter_name`, `ip_allowlist_parameter_name`, `cloudfront_price_class`, `log_retention_days`) also have the same values as their defaults. The variables that are not in the template (the SSM parameter names `allowed_account_ids_parameter_name`, `auth_mode_parameter_name`, and `auth_cognito_parameter_name`) use their defaults. If you change an SSM parameter name (`*_parameter_name`), you must also rewrite the constant in Lambda@Edge and rebuild (see the `description` of each variable and [limitations.md](../limitations.md) (Japanese)). Unless you have a reason to change them, leave them as they are.

**Do not write credentials** in `terraform.tfvars`. You put the Basic authentication credentials into SSM after the apply.

> **Decide `pool_id`.** Rolust manages only one user pool per deployment. `pool_id` is its identifier (alphanumeric characters and `.` `_` `-`, 1 to 64 characters), and it becomes the DynamoDB key and the Lambda environment variable `ROLUST_POOL_ID`. **When you update an existing deployment, use the same value as the identifier of the existing user pool** (if you change it, the data you had until then becomes invisible). In every later `terraform plan` and `terraform apply`, use the same value from `terraform.tfvars`.

> **Decide `managed_tag_key` and `managed_tag_value` first.** The only roles Rolust can handle are those that carry this tag. The default is `rolust:managed` = `true`. For details, read "Managed roles are narrowed down by IAM role tags" in [managed-roles.md](../managed-roles.md) (Japanese).

> **Keep a copy of `terraform.tfvars` and `backend.hcl` outside the extracted directory.** When you update to a new version, you carry these two files over to the new extracted directory ([operations.md](../operations.md#新しいバージョンに更新する経路-a) (Japanese)). They are not in the tarball (they are values specific to each environment), and if you lose them you no longer know your `pool_id`, and the data you had until then becomes invisible.
>
> - Store them outside the extracted directory (a password manager, a private internal store, and so on). **Do not commit them to a public repository.** The bucket name in `backend.hcl` can contain the account ID. The rule is not to write credentials in `terraform.tfvars`, so its contents are not secret.
> - When you change a value, update the copy too.
> - If you created the state bucket with `infra/bootstrap/`, also keep a copy of `infra/bootstrap/terraform.tfstate` (even if you lose it, you can import the bucket again with the `import` in step 2).
> - If you have lost the copies as well, you can recreate the files by following ["When you have lost the configuration files" in operations.md](../operations.md#設定ファイルを紛失したとき) (Japanese).
>
> The command to keep a copy outside the extracted directory (run it inside `infra/`):
>
> ```bash
> cp terraform.tfvars backend.hcl <storage outside the extracted directory>/
> ```

## 4. Apply

Check that the `AWS_PROFILE` / `AWS_REGION` you exported in step 2 are still set in this shell (`echo "$AWS_PROFILE"`). If they are not, `plan` fails with `No valid credential sources found`.

```bash
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
../.github/scripts/plan-guard.sh tfplan.json   # Exits 1 if there is a red flag. In that case, do not go on

```

If there is no red flag, and after you have checked the warnings (WARN) by eye, run the following.

```bash
terraform apply tfplan
rm -f tfplan tfplan.json
cd ..                                          # Go back to the root of the extracted directory (run step 5 and later from the root)

```

Steps 3 and 4 were run inside `infra/` (the `cd infra` in step 3). **From step 5 on, run `terraform output` from the root of the extracted directory as `terraform -chdir=infra output …`.** If you add `-chdir=infra` inside `infra/`, it looks for `infra/infra` and fails. If you run it at the root without `-chdir`, there is no configuration, so you get a "no outputs" warning.

If you forget `-backend-config`, `terraform init` asks you interactively for the backend settings. Always pass the `backend.hcl` you created in step 2.

**`plan-guard.sh` looks in the plan diff for changes that quietly widen the permission scope (red flags R-1 to R-12).** If a red flag appears, do not apply. The meaning and the response are in the section "赤信号 — 承認せず差し戻す" (red flags — reject rather than approve) of `docs/design/cicd-pipeline.md` (Japanese). It needs bash and jq (Git Bash on Windows).

On the first run, warnings (WARN) appear because the values of the resources to be created are not fixed at plan time. A warning means "could not be checked", not "no problem". Check the affected places by eye in the plan with `terraform show tfplan` before you apply. `terraform apply tfplan`, which applies the saved plan, applies it without asking for confirmation.

`tfplan` and `tfplan.json` can contain decrypted SSM SecureString values, so delete them after the apply (they are already in `.gitignore`).

What is created:

- The DynamoDB state table (`rolust-state`, with one GSI) and the request table (`rolust-change-requests`) (both PAY_PER_REQUEST)
- Three Lambda functions (crud / diff / apply) and an execution role for each
- API Gateway (REST) — the origin of `/api/*` in CloudFront
- An S3 bucket (private; readable only through the CloudFront OAC) and the SPA upload
- A CloudFront distribution (with Lambda@Edge associated to viewer-request)
- Lambda@Edge and its execution role (**us-east-1**)
- An SSM parameter (SecureString, **the value is a placeholder**)
- An SSM parameter (String, the IP allow list. **The initial value is `0.0.0.0/0`, which allows everything**)
- An SSM parameter (String, the allow list of account IDs of the IAM users that can be registered in the user pool. **The initial value is only the deployment account**. In the deployment region)
- The API Gateway API key and usage plan (CloudFront adds the key as `x-api-key`, which blocks the direct URL of API Gateway)
- **The API Gateway account setting** (the role `<project_name>-apigw-logs` for writing to CloudWatch Logs, and the `cloudwatchRoleArn` that points to it). **This is not a Rolust resource; it is a setting per account and region.** Other REST APIs in the same account and region also start writing logs with the same role, and if another role is already set, it is overwritten (it appears in the plan diff). `terraform destroy` resets this setting, so if you want to keep it, run `terraform state rm aws_api_gateway_account.this` before the destroy

Creating CloudFront takes several minutes to ten-odd minutes.

## 5. Prepare authentication

According to the `auth_mode` you decided in step 3, do one of the following. Skip the other.

### When `auth_mode = "basic"` (the default): put the credentials in

The **value of the SSM parameter is outside Terraform's management** (`lifecycle { ignore_changes = [value] }`). The placeholder right after the apply is deliberately an invalid value that contains no `:`, and `packages/edge-auth` does not let it through and returns `503`. **The console stays closed until you put in the real value** (fail closed).

```bash
# Run from the root of the extracted directory
terraform -chdir=infra output -raw set_basic_auth_command      # Prints the command to run (same as below, including the export line)

export MSYS_NO_PATHCONV=1                         # Prevents Git Bash from converting '/rolust/basic-auth' into a path
aws ssm put-parameter \
  --region us-east-1 \
  --name '/rolust/basic-auth' \
  --type SecureString \
  --overwrite \
  --value '<user>:<password>'
```

> **If you use Git Bash (Windows)**: without `MSYS_NO_PATHCONV=1`, `/rolust/basic-auth` is converted into a Windows path, and `put-parameter` stops with `ValidationException ... Parameter name must be a fully qualified name` (`get-parameter` returns ParameterNotFound). The command printed by `terraform output` already includes the `export` line. It is not needed on macOS / Linux.

Lambda@Edge caches the credentials in the execution context for **5 minutes** (`CACHE_TTL_MS`). Right after you put them in, it can take up to 5 minutes to take effect.

### When `auth_mode = "cognito"`: create the administrator users

The Cognito user pool was created by the apply in step 4. Create the administrator users and assign permission groups by following item 3 of "Choosing an authentication method" and "Administrator permissions" in [access-control.md](access-control.md). **Creating a user alone does not let them do anything.** You must assign them to exactly one of `viewer` / `editor` / `applier`. In this case, you do not do the `basic` credential setup above.

## 6. Check that it works

```bash
# Run from the root of the extracted directory
terraform -chdir=infra output -raw console_url
```

1. Open the printed URL in a browser → with `basic`, the Basic authentication dialog appears. With `cognito`, you are taken to the Cognito sign-in page (**if neither appears, authentication is not working**)
2. Wrong credentials → `401` (with `cognito`, the sign-in page shows the error)
3. Correct credentials → the "IAM users" screen appears (with `cognito`, sign in as the user you created in "Choosing an authentication method" in [access-control.md](access-control.md))
4. "Register new user" → enter an AWS account ID and an IAM user name and register
5. **Tag the role you want to register** (this is work on the AWS side, not on the screen. Rolust does not have `iam:TagRole`, so an operator does this):

   ```bash
   # Check the current managed tag (run from the root of the extracted directory)
   terraform -chdir=infra output -raw managed_role_tag        # => rolust:managed=true

   aws iam tag-role --role-name <RoleName> --tags Key=rolust:managed,Value=true

   ```

6. "IAM roles" → register the role ("Register new role") (enter **a role that exists in this account and carries the tag from step 5**. If the tag is missing, the value is different, or the role does not exist, registration is rejected, and which one applies is shown in the modal)
7. "Role assignments" → choose the user pool and check the intersections (nothing is written to AWS at this point)
8. "Create requests" → check the principals to be added or removed on the diff review screen → "Apply N selected requests"
9. Check the result with the AWS CLI:

   ```bash
   aws iam get-role --role-name <RoleName> \
     --query 'Role.AssumeRolePolicyDocument' --output json
   ```

10. "Request history" → the status should be "Applied"

### Reference: create a role with an empty trust policy (a role that has no IAM users yet)

This is an example of creating a role that is tagged at creation (the tagging of step 5) and whose trust policy holds only `RolustPlaceholder`. When you add the first user and apply, Rolust removes the placeholder (see "A trust policy cannot be made 'empty'" in [managed-roles.md](../managed-roles.md) (Japanese)).

```bash
# Run from the root of the extracted directory (with the credentials of the account where you want to create the role. If it is a different account from the deployment account, see the note below)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')   # Do not print it on the screen
TAG=$(terraform -chdir=infra output -raw managed_role_tag | tr -d '\r')                # => rolust:managed=true
echo "$TAG"                                       # Check that it is in the key=value form. If it is empty, do not go on

POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"RolustPlaceholder","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::'"$ACCOUNT_ID"':root"},"Action":"sts:AssumeRole","Condition":{"DateLessThan":{"aws:CurrentTime":"1970-01-01T00:00:00Z"}}}]}'

aws iam create-role --role-name <RoleName> \
  --assume-role-policy-document "$POLICY" \
  --tags "Key=${TAG%%=*},Value=${TAG#*=}"

```

- **Do not change the `Sid` from `RolustPlaceholder`.** Rolust recognizes the placeholder only by its `Sid`. If you change it, it is not removed even when you add the first user.
- **Do not make the `Effect` `Deny`.** An explicit Deny wins over any Allow added later, so the role becomes permanently impossible to assume.
- **Attach the managed tag at creation.** If you do not, the registration in step 6 is rejected. Check the key and value with `terraform -chdir=infra output -raw managed_role_tag` (the `TAG` above is in the form `key=value`; `${TAG%%=*}` is the key and `${TAG#*=}` is the value).
- **Do not go on to `create-role` while `TAG` is empty.** If it is empty, it fails with `Invalid length for parameter Tags[0].Key`, and the cause (that `terraform output` failed) becomes hard to see. The main causes of a `terraform output` failure are the place you run it from (run it at the root of the extracted directory with `-chdir=infra`) and the credentials (see the next note).
- **When the account where you create the role is different from Rolust's deployment account**, use two sets of credentials. `terraform output` fails with a 403 on S3 `HeadObject` unless you use the credentials of the account that holds the state (the deployment account). Run `aws iam create-role` with the credentials of the account where you want to create the role. Decide `TAG` in one of the following ways.
  - If you have not changed `managed_tag_key` and `managed_tag_value` in `terraform.tfvars`, write the defaults directly: `TAG='rolust:managed=true'`. If you have changed them, use those values (check with `grep -E 'managed_tag_(key|value)' infra/terraform.tfvars`; if they are still commented out, they are the defaults). This does not touch the state, so you do not need to switch credentials.
  - Read it with the deployment account's credentials: `TAG=$(AWS_PROFILE=<deployment account profile> terraform -chdir=infra output -raw managed_role_tag | tr -d '\r')`.
- **`ACCOUNT_ID` goes only into the `Principal` (the placeholder) of the trust policy. It does not decide the account where the role is created.** The account where it is created is decided by the credentials you run `create-role` with.
- To register and operate a role in another account from Rolust's screen, the target side needs `RolustTrustPolicyReader` and `RolustTrustPolicyManager` ([cross-account.md](cross-account.md)).
- **In Git Bash (Windows), `--assume-role-policy-document file://...` can fail because of path conversion.** Put the JSON in a variable as above and pass it inline. Remove the `\r` that gets attached to `aws` output with `tr -d '\r'`.
- Keep the account ID in a variable, and do not paste it on the screen, in logs, or in Issues and PRs.

For the IP address restriction (optional), see "IP address restriction" in [access-control.md](access-control.md).
