# Authentication and access restriction

**English** | [日本語](../access-control.md)

## Choosing an authentication method

Authentication for the console and the API is selected with `auth_mode`. The default is `basic` (Basic authentication with a single set of credentials). To let several administrators sign in with their own credentials, choose `cognito` (an Amazon Cognito user pool). In both modes, the IP allow list (see "IP address restriction" below) is evaluated before authentication.

1. Write `auth_mode = "cognito"` in `terraform.tfvars` and apply (the same as "3. Prepare the Terraform variables" and "4. Apply" in [setup.md](setup.md). **If you write it before the first apply, the 503 during the switch does not occur**). **When you switch an environment that has already been applied with `basic`, every request can return 503 during the switch and for up to 5 minutes after it takes effect (the Lambda@Edge cache).** Cognito is created after CloudFront is updated, and the sign-in page takes a few minutes to become available.
2. Use the same value in every later `terraform plan` and `terraform apply`. Writing it in `terraform.tfvars` is enough. If you pass it with `-var` or an environment variable, use the same value. If the value goes back to `basic`, the destruction of Cognito appears in the diff (plan-guard does not raise a red flag for this destruction. Check the plan diff yourself).
3. **Adding users** (after creating a user, assign a permission group; see "Administrator permissions" below): `terraform -chdir=infra output -raw create_cognito_user_command` (run it from the root of the extracted directory) prints the command to run. Replace the `<...>` placeholders and run it. Register the email address as verified (`email_verified=true`).
   - **Do not choose the temporary password yourself.** The `--temporary-password` in the printed command is generated from random numbers inside the command (`printf '%sAa1!' "$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9')"`). It is at least 12 characters long and contains lowercase letters, uppercase letters, digits, and symbols, so it satisfies the password policy. The value is not shown on screen; Cognito sends it to the registered email address. If you rewrite it by hand, the password policy also applies to the temporary password. If it does not comply, the command fails with `InvalidPasswordException` (`Password did not conform with password policy`), and Cognito reports only one violation at a time.
   - Cognito sends the temporary password to the registered email address (the subject is `Your temporary password`).
   - At the first sign-in, you are asked to set a new password (the same policy applies).
   - **Creating a user alone does not let them do anything.** Next, assign the user to exactly one permission group (`viewer` / `editor` / `applier`) (see "Administrator permissions" below). Until you do, signing in only shows "You have no permission for any operation".
4. **Passwords**: users can change their own password only through the forced change at the first sign-in and the reset from "Forgot your password?" on the sign-in page. **There is no screen for changing the password after you have signed in.** An operator can always set one with `aws cognito-idp admin-set-user-password --permanent`.
   - **"Forgot your password?" does not send a confirmation code email until the user has set a password at the first sign-in.** For a user who has just been created (status `FORCE_CHANGE_PASSWORD`), the screen responds as if it succeeded, but no email is sent (measured. It does arrive for a user with the status `CONFIRMED` under the same settings).
   - **If the confirmation code does not arrive, try the following in order.** (1) If the user was just created, sign in with the temporary password from the email and set a new password right away. No email is involved. (2) An operator sets it directly with `aws cognito-idp admin-set-user-password --permanent`. (3) Only if it still does not arrive, check the spam folder and any quarantine on the mail system side. Cognito's default sender uses the `verificationemail.com` domain.
5. **Deleting and disabling users**: `aws cognito-idp admin-delete-user` / `admin-disable-user`. **ID tokens that have already been issued remain usable until they expire (up to 1 day).** To lock someone out immediately, switch `auth_mode`.
6. **Sessions**: an ID token is valid for 1 day. After it expires, API calls from a tab that was left open return 401. Reloading the page takes you to the sign-in page.
7. **Going back to Basic**: set `auth_mode = "basic"` (or remove it) and apply. **The Cognito user pool and its users are destroyed.** The value in the `basic-auth` SSM parameter can be used as it is (see the `basic` case in "5. Prepare authentication" in [setup.md](setup.md)).
8. **Cost**: a new user pool (Lite) is free up to 10,000 MAU (the official price list as of 2026-10-05). Email uses Cognito's default sending. There is a limit on the number of messages, but it is not a problem for a few administrators. After the apply, check in the console that the feature plan of the pool is Lite.
9. **What an unauthenticated request looks like**: with `cognito`, a page request gets 302 (to Cognito's `/oauth2/authorize`) and `/api/` gets 401 (without `WWW-Authenticate`). If you get 200, authentication is not working.
10. **Recording who did it**: the creator and the applier of a request appear in the request history. With `cognito`, they are the Cognito user name (and the `sub`, which is not shown on screen); with `basic`, only the Basic authentication user name (there is a single set of credentials, so several people cannot be told apart). Requests made before the recording started show "—". Lambda@Edge adds `x-rolust-actor` only to signed-in requests, and discards a header of the same name sent by the viewer.
11. **Logging out**: "Log out" at the top right of the console deletes Rolust's cookie (`__Host-rolust-id`) and ends the Cognito session. After logging out, you return to the Cognito sign-in page. **Logging out does not invalidate an ID token that has already been issued.** A copied token remains usable until it expires (up to 1 day) (an accepted residual risk). To lock someone out immediately, switch `auth_mode`. Disabling or deleting a user does not stop an ID token that has already been issued (see 5 above). `basic` has no logout.

## Administrator permissions

With `auth_mode = "cognito"`, administrator permissions are divided into three levels by Cognito groups. The levels are cumulative, and **you assign each user only the highest one** (if a user belongs to several groups, the highest one takes effect).

| Group | What it allows |
|---|---|
| `viewer` | View only (the role assignments, the request history, the diff review, and checking trust policy drift) |
| `editor` | In addition to viewing: editing the role assignments; registering, editing, and deleting users and roles; creating and discarding requests; the drift repair operations ("Make IAM match the records (create request)" and "Make the records match IAM". Applying a request requires `applier`) |
| `applier` | In addition to creating: applying to trust policies |

- **There is no mechanism that separates the requester from the applier** (added on 2026-10-24). The levels are cumulative, so an `applier` can apply a request that they created themselves. If you need an operation that requires a second person to approve (so-called four eyes), the most you can do is assign `editor` and `applier` to different people and not let the `applier` edit the role assignments (Rolust does not enforce this).
- **A user who belongs to no group cannot do anything** (the console shows "You have no permission for any operation", and the API returns 403). After you create a user, assign a group. The result is the same in the console and on the command line.

  **In the AWS Management Console**

  > The labels are those of the English console. They can change when the console is updated.

  1. Note the pool ID. You can get it with `terraform -chdir=infra output -raw cognito_user_pool_id`. In the console, open the target pool from the list of Cognito user pools, and it is shown in the overview.
  2. Open Amazon Cognito in the AWS Management Console (in the region where you deployed Rolust) and select the target pool from "User pools".
  3. In the left menu, open "Users" under "User management", and open the link of the target user name in the list.
  4. In "Group memberships", choose "Add user to group". From the list of groups (`viewer` / `editor` / `applier`), select **only the highest one** with the radio button, and choose "Add".
  5. Check that the selected group appears in "Group memberships" in the user's details.
  6. After assigning, the user must **sign in again** (groups are included in the ID token, so tokens that have already been issued do not contain them).

  **On the command line**

  ```bash
  aws cognito-idp admin-add-user-to-group --user-pool-id <pool ID> --username <user name> --group-name applier --region <region>
  # To remove: admin-remove-user-from-group
  ```

- **When you update from a version that has no permission groups (an environment that already has administrators), assign `applier` to the current administrators right after `terraform apply`.** Between the groups being created and your assigning them, those administrators get 403 on every API. After assigning, they must **sign in again** (groups are included in the ID token, so tokens that have already been issued do not contain them).
- **A change of permissions does not take effect until the ID token expires (up to 1 day).** Even if you remove a user from a group, a token that has already been issued keeps passing with the old permissions until it expires. Even if you `admin-disable-user` the user to stop them quickly, a token within its lifetime still passes (Lambda@Edge verifies only the signature and the expiry). To stop them for certain, switch `auth_mode` (item 5 of "Choosing an authentication method").
- `basic` cannot identify groups, so it grants every permission.
- **Terminology**: there is no "approval" step. A person with the apply permission presses "Apply". The "Applied" date in the request history used to be called the "approval date".
- **Handing over a request**: each card on the Review and apply screen (screen 4) and each row of the request history has the request ID and "Copy URL". Opening the URL (`/requests?ids=<id>`) goes straight to the diff review and apply screen. People who can only view can also see the diff (the apply button is disabled).

## IP address restriction (optional)

Before Basic authentication (see the `basic` case in "5. Prepare authentication" in [setup.md](setup.md)), Lambda@Edge checks the client's IP address against the SSM parameter `/rolust/ip-allowlist` (String). **Right after the apply, the value is `0.0.0.0/0` (allow all)**, and the behavior is the same as with Basic authentication alone. Rewrite the value only when you want to restrict access.

The format is IPv4 addresses or CIDRs separated by commas (spaces are ignored). An IP address without a CIDR allows only that one address (`/32`). IPv6 is not supported.

```bash
# Run from the root of the extracted directory
terraform -chdir=infra output -raw set_ip_allowlist_command    # Prints the command to run (same as below, including the export line)

export MSYS_NO_PATHCONV=1                         # Prevents Git Bash from converting '/rolust/ip-allowlist' into a path
aws ssm put-parameter \
  --region us-east-1 \
  --name '/rolust/ip-allowlist' \
  --type String \
  --overwrite \
  --value '<IP address or CIDR to allow>'
```

For `--value`, enter **the IP address (or CIDR) of the connection you use**. You can list several separated by commas. Example: `203.0.113.0/24,198.51.100.7` (these are addresses reserved for documentation. **Do not run it as it is.** If you do, the allow list contains only the documentation addresses, and everyone, including you, gets 403).

- Access from an IP address that is not in the allow list gets **403**, for both the SPA and `/api/*`.
- **If the value is empty, malformed, or cannot be fetched, every request is rejected (`503`).** This is so that a configuration mistake does not silently remove the restriction.
- A change takes **up to 5 minutes** to take effect (it uses the same cache as the Basic authentication credentials).
- **If you lock yourself out**: from any connection, you can restore the value with `aws ssm put-parameter` (the SSM API is not subject to this IP restriction). Even after you restore it, you cannot get in for up to 5 minutes until it takes effect.
- When you do not use it, leave the initial value `0.0.0.0/0` as it is.

If you change `--name` from the default, set the Terraform variable `ip_allowlist_parameter_name` and `IP_ALLOWLIST_PARAMETER_NAME` in `packages/edge-auth/src/index.ts` to the same value, and rebuild.

## Basic authentication is a "minimal access restriction"

(The following applies when `auth_mode = "basic"`. With `cognito`, Cognito sign-in takes the place of Basic authentication, credentials are per user, and permissions are divided by Cognito groups (see "Administrator permissions" above). An ID token that has already been issued remains usable until it expires (up to 1 day). See "Choosing an authentication method" above.)

The requirement for this access restriction is to make the console "unreachable without authentication". Basic authentication sends the plaintext password with every request (over TLS, though), so you can also choose IP address restriction (see "IP address restriction" above). No additional defenses such as SSO or WAF are provided. The IP restriction and Basic authentication are on the CloudFront side and do not apply to the direct URL of API Gateway. The direct URL is blocked with an API key (see "Do not distribute the API Gateway endpoint" below).

### No brute-force protection (added for Issue #194 on 2026-10-23)

**There is no limit on the number of attempts, no delay, no lockout, and no record of attempts.** The credentials are checked in Lambda@Edge (the comparison itself takes constant time), and wrong credentials can be tried any number of times. Failed attempts are not left in the application log, and CloudFront access logs are not enabled, so there is also no way to notice that you are under a brute-force attack.

Therefore, the defense of `auth_mode = "basic"` depends on the following two things.

- **Make the credentials long enough.** Rolust places no constraint on the length or character types of the Basic authentication password (it uses the value placed in SSM as it is). Make it long enough that neither guessing nor brute force can succeed: 32 or more random characters. Credentials cannot be separated per user either, so if the single set of credentials leaks, it leaks for everyone.
- **Combine it with IP address restriction if you can restrict.** The allow list in "IP address restriction" above is the only layer that stops requests from reaching the console at all.

With `cognito`, Cognito's own protection against consecutive failures (a delay is added after a certain number of failures) applies, and passwords must be at least 12 characters and contain uppercase letters, lowercase letters, digits, and symbols. However,

- **multi-factor authentication is disabled** (`mfa_configuration = "OFF"`. Enable it with Terraform if you need it).
- The user pool plan is Lite, so threat protection (detection of leaked passwords and adaptive authentication) is not available.

If an administrator's credentials leak, the only layer that stops requests from reaching the console is the IP allow list, as with `basic`.

In an environment that needs strong protection, put Rolust behind the existing authentication infrastructure of your own account, or restrict access with the IP allow list.

## Do not distribute the API Gateway endpoint

**Do not distribute the API Gateway endpoint.** It is a path that does not go through CloudFront, so Basic authentication and the IP allow list do not apply to it. A request without the API key (`x-api-key`) that CloudFront adds is rejected by API Gateway with 403 before it calls Lambda. The API key is one layer of defense in depth, not a substitute for authentication (the same note appears in `terraform -chdir=infra output api_gateway_invoke_url`).
