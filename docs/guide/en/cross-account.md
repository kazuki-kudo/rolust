# Cross-account setup

**English** | [日本語](../cross-account.md)

Rolust can also register, link, review the diff of, and apply to **IAM roles in an account other than the one where you deployed Rolust (the "deployment account" below)**; those accounts are called "targets" below. The steps are the same as for roles in the deployment account. Rolust's Lambda functions assume two roles that you create in the target (with a CloudFormation template) (`sts:AssumeRole`) and call IAM with them. **The roles on the target side are not created by Terraform.** They are **needed only for cross-account use**. If you manage only roles in the deployment account, you do not need them.

| Role on the target side | Assumed by | Permissions |
|---|---|---|
| `RolustTrustPolicyReader` | CRUD and Diff | `iam:GetRole` (only for roles that carry the managed tag), `iam:ListRoleTags` |
| `RolustTrustPolicyManager` | Apply only | `iam:GetRole` and `iam:UpdateAssumeRolePolicy` (both only for roles that carry the managed tag). Updating its own trust policy and the Reader's is denied |

CRUD cannot assume the Manager, so the guarantee that "operations on the role assignments never write to AWS" also holds for roles in the target.

Roles in the deployment account are operated, as before, with the execution role's own credentials (no preparation is needed on the target side). Rolust chooses the credentials by whether the account ID in the role's ARN is the same as the deployment account (the `requestContext.accountId` of API Gateway).

**If assuming the role fails, Rolust does not retry with the deployment account's credentials.** The IAM API is called with only a role name, and it is resolved against the account of the credentials used for the call, so a retry would read and write a role with the same name in the deployment account. The failure is shown with a message that includes the cause and how to fix it.

## Steps (once per target account)

Prerequisite: `terraform apply` has been done for the deployment account (this adds the `sts:AssumeRole` permission on the execution roles and the Lambda environment variables). `cloudformation/target-roles.yaml` is in the directory where you extracted the tarball (or at the repository root).

1. **Check the command and run it.** **Run every command from here on at the root of the extracted directory (or the repository)** (not inside `infra/`; `-chdir=infra` points to `infra/`). With the deployment account's credentials, run the following.

   ```bash
   terraform -chdir=infra output -raw target_roles_deploy_command
   ```

   The values (the deployment account ID, the project name, the managed tag, and the role names) are already filled in from these Terraform variables. In the printed `aws cloudformation deploy …`, replace `--profile` with the profile of **credentials that can manage IAM in the target account**, and run it at the root of the extracted directory (or the repository). Two roles are created (`RolustTrustPolicyReader` and `RolustTrustPolicyManager`; the names can be changed with `target_reader_role_name` and `target_manager_role_name`).

   Do not remove `AWS_CLI_FILE_ENCODING=UTF-8` at the start of the command. The template contains Japanese, so without it the AWS CLI on Windows (whose character encoding is CP932) fails with `'cp932' codec can't decode byte …` (found by measurement; it is harmless on macOS and Linux). When you run it in PowerShell, first set `$env:AWS_CLI_FILE_ENCODING = "UTF-8"` and remove the `AWS_CLI_FILE_ENCODING=UTF-8` at the start of the line.

   When you later change a Terraform variable (`project_name`, `managed_tag_key`, `managed_tag_value`, or a role name), run this command again.

2. **Tag the roles you want to operate on** (in the target, as before; an operator attaches the tag):

   ```bash
   aws iam tag-role --role-name <RoleName> --tags Key=rolust:managed,Value=true
   ```

3. **Check.** On Rolust's IAM roles screen, register a role in the target ("Register new role"; enter the target's account ID). If registration succeeds, the Reader can be assumed and the tags can be read. Check the diff review and the apply, including the Manager, with a request for that role.

You can check what was created with `aws iam get-role --role-name RolustTrustPolicyReader` and similar commands. The definition is only in `cloudformation/target-roles.yaml`.

### Replacing existing roles that were created by hand

In an environment that already has roles created by hand (with `aws iam create-role` or similar), creating the stack fails with `AlreadyExists` because roles with the same names already exist. **Delete the two existing roles, and then create the stack.** In the meantime, operations on roles in that target fail. Right after you recreate them, assuming the roles can return `AccessDenied` for a few minutes because IAM is eventually consistent (see "Notes" below).

## Troubleshooting

| What you see | Cause | How to fix |
|---|---|---|
| `Could not assume the role RolustTrustPolicyReader (or Manager) in account X (AccessDenied)` | The target does not have that role, or its trust policy does not allow Rolust's execution role | Step 1 (create the stack; check that parameters such as `project_name` match Terraform) |
| At registration, `The IAM role "…" does not have the managed tag "…"` | The target role has no tag | Step 2 |
| At registration, `Could not read the tags of the IAM role "…" (account …) (AccessDenied)`, with a hint about the Reader's `iam:ListRoleTags` | The Reader's permission policy is insufficient (the template is old) | Step 1 (update the stack with the latest version of the template) |
| At role registration, `Could not read the trust policy of the IAM role "…" (account …) (AccessDenied)` | The target role has no tag, or the Reader does not have `iam:GetRole` | Steps 1 and 2 |
| The apply ends as "Failed" (assuming the Manager, or `AccessDenied`) | The Manager does not exist, its trust policy does not allow `apply-exec`, or the target role has no tag | Steps 1 and 2 |

## Notes

- **Right after you fix the trust policy of a role on the target side, assuming it can keep returning `AccessDenied` for a few minutes** (IAM is eventually consistent. In a measurement, it took about 7 minutes after restoring the Manager's trust policy until the first call succeeded). Rolust does not remember assume failures and asks STS every time, so you do not need to restart Lambda. Wait a few minutes and repeat the operation.
- **If you delete and recreate Rolust's execution role (for example, `terraform destroy` → `apply`), the trust policies on the target side become invalid.** The Principal of a trust policy is written as the role's ARN, but IAM converts it internally into a unique ID and keeps that. If you recreate the execution role, it no longer matches even though the name is the same, and assuming the role returns `AccessDenied`. **Running `target_roles_deploy_command` again does not fix it** (CloudFormation decides "No changes to deploy" and does not update the trust policies). In the target account, delete the stack and then run `target_roles_deploy_command` again (`aws cloudformation delete-stack` → wait for it to complete → the command. In a measurement, the roles could be assumed right after recreating them). In the meantime, operations on roles in that target fail. The execution role name derives from `project_name`, so it does not normally change. In this environment, if Terraform tries to recreate only the execution role with `-replace`, it fails with `EntityAlreadyExists`, and only the role's inline policies are removed. When that happens, run `terraform plan` and `apply` again, and the removed policies come back.
- **Keep the parameters of the stack on the target side the same as the Terraform variables.** If the managed tag key and value, the role names, or the project name drift apart, registration (including importing the trust policy), diff review, and apply fail as in the table above (it never acts on a different role silently). `target_roles_deploy_command` is filled in from the Terraform variables, so running it as it is keeps them in agreement.
- **ExternalId is not used.** The trust policy names the execution role's ARN with an exact match, so no other principal can assume the role. What ExternalId prevents is the setup in which a third-party service assumes the roles of many customers on their behalf. Each operator deploys Rolust for themselves, so that setup does not arise.
- The Reader has `iam:ListRoleTags` (without a tag condition), so Rolust's CRUD and Diff can read the tags of every role in the target (read-only). Adding or removing managed roles (attaching or detaching the tag) does not appear in `terraform plan` on the target side either.
- The roles on the target side are distributed as a CloudFormation template (`cloudformation/target-roles.yaml`). A Terraform module and StackSets are not provided. The design is in section 3.3 of `docs/design/iam-policy-design-note.md` (Japanese).
