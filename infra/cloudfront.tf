/**
 * SPA の配信（C-2 / DF-5）と入口の認証（FR-6.1）。
 *
 * ```
 *  viewer ──▶ CloudFront ──(viewer-request: Lambda@Edge Basic 認証)──┬──▶ S3（OAC。SPA の静的ファイル）
 *                                                                    └──▶ API Gateway（/api/*）
 * ```
 *
 * SPA と API を**同一オリジン**にするのは、Basic 認証の入口を 1 箇所に閉じるためである。
 * 別オリジンにすると API 側が Lambda@Edge を通らず、認証を迂回できてしまう。
 * `packages/api/src/http.ts` が CORS ヘッダを付けないのも同じ理由による。
 */

locals {
  web_dist   = "${path.module}/../packages/web/dist"
  s3_origin  = "s3-spa"
  api_origin = "api-gateway"

  content_types = {
    "html"  = "text/html; charset=utf-8"
    "js"    = "text/javascript; charset=utf-8"
    "mjs"   = "text/javascript; charset=utf-8"
    "css"   = "text/css; charset=utf-8"
    "json"  = "application/json"
    "map"   = "application/json"
    "svg"   = "image/svg+xml"
    "png"   = "image/png"
    "jpg"   = "image/jpeg"
    "ico"   = "image/x-icon"
    "woff"  = "font/woff"
    "woff2" = "font/woff2"
    "txt"   = "text/plain; charset=utf-8"
  }
}

# --- S3（静的ファイル。公開しない。CloudFront の OAC 経由でのみ読める） -------

resource "aws_s3_bucket" "web" {
  bucket        = "${var.project_name}-web-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

/**
 * ビルド済み SPA をアップロードする。
 *
 * NFR-4（第三者が README と Terraform 一式でセットアップを完了できる）のため、
 * 配信物の配置も `terraform apply` に含める。`npm run build` を先に実行しておくこと
 * （`packages/web/dist` が空だと 0 件アップロードになり、CloudFront が 403 を返す）。
 */
resource "aws_s3_object" "web" {
  for_each = fileset(local.web_dist, "**")

  bucket = aws_s3_bucket.web.id
  key    = each.value
  source = "${local.web_dist}/${each.value}"
  etag   = filemd5("${local.web_dist}/${each.value}")

  content_type = lookup(
    local.content_types,
    lower(try(element(split(".", each.value), length(split(".", each.value)) - 1), "")),
    "application/octet-stream"
  )

  # index.html と favicon.ico（名前にハッシュが付かず、差し替えうる）は常に取り直す。ハッシュ付きの資産は長期キャッシュしてよい。
  cache_control = (endswith(each.value, ".html") || each.value == "favicon.ico") ? "no-cache" : "public, max-age=31536000, immutable"
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web-oac"
  description                       = "Rolust の SPA バケットへの署名付きアクセス"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontServicePrincipalReadOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.rolust.arn
        }
      }
    }]
  })
}

# --- CloudFront -------------------------------------------------------------

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
}

/**
 * セキュリティヘッダ（Issue #13）。SPA と `/api/*` の両方に当てる。
 *
 * マネージドの `Managed-SecurityHeadersPolicy` は CSP を足せないため、独自ポリシーに置き換えた。
 * HSTS・X-Frame-Options・Referrer-Policy・nosniff はマネージドと同じ値である。
 * X-XSS-Protection は付けない（旧来の機構で、CSP を持つ場合は不要とするのが OWASP の推奨）。
 * どのオリジンもこれらのヘッダを返さないため、すべて `override = true` で固定する。
 *
 * CSP の許可元は `npm run build` の成果物を実測して決めた（外部参照・インラインスクリプト・eval は無い）。
 *   - style-src 'unsafe-inline': Cloudscape が要素の style 属性でスタイルを当てる
 *   - font-src data:            : Cloudscape の CSS が Open Sans を data:font/woff2 で埋め込んでいる
 *   - connect-src 'self'        : API は同一オリジンの `/api/*`（ファイル冒頭の構成図）
 * 外部の CDN やフォントを足すと、ここを直さない限りブラウザが読み込みを拒否する。
 */
resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name    = "${var.project_name}-security-headers"
  comment = "Rolust のセキュリティヘッダ（CSP を含む）"

  security_headers_config {
    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ])
      override = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      override                   = true
    }

    frame_options {
      frame_option = "SAMEORIGIN"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    content_type_options {
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "rolust" {
  enabled             = true
  comment             = "Rolust 管理画面（Basic 認証つき）"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    origin_id                = local.s3_origin
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = local.api_origin
    domain_name = "${aws_api_gateway_rest_api.rolust.id}.execute-api.${var.region}.amazonaws.com"
    origin_path = "/${aws_api_gateway_stage.rolust.stage_name}"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # API Gateway が検証する API キー（FR-6.3）。ビューアーが同名のヘッダーを送ってきても、
    # CloudFront はオリジンのカスタムヘッダーの値で上書きする。
    custom_header {
      name  = "x-api-key"
      value = aws_api_gateway_api_key.rolust.value
    }
  }

  # SPA の静的ファイル。
  default_cache_behavior {
    target_origin_id       = local.s3_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    # viewer-request はキャッシュヒット時にも必ず実行される。認証が素通りする経路はない。
    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.edge_auth.qualified_arn
      include_body = false
    }
  }

  # API。キャッシュせず、クエリ文字列とメソッドをそのまま通す。
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = local.api_origin
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.edge_auth.qualified_arn
      include_body = false
    }
  }

  /**
   * SPA のディープリンク（`/matrix`、`/requests?ids=...` など）の index.html への書き換えは、ここ（カスタムエラー応答）では
   * 行わない。**Lambda@Edge（`packages/edge-auth` の `rewriteSpaRoute`）が、認証を通した後に uri を書き換える**。
   *
   * 以前は `custom_error_response`（403 → /index.html・200）で寄せていた（OAC 構成の S3 は存在しないキーに 403 を返す）。
   * しかしこれはディストリビューション全体に効くので、API Gateway が返す 403（権限なし。FR-6.5。Issue #141）まで
   * HTML の 200 に化けた（応答ヘッダー `x-cache: Error from cloudfront`）。API のエラーを書き換えないため外した。
   * 外した後、S3 に無いアセットは 403 / 404 がそのまま返る。
   */

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  # 新しい edge-auth のコードが動き始める（関連付けの更新）前に、IP 許可リストと認証方式のパラメータと、
  # それを読む権限が揃っているようにする（FR-6.2・FR-6.4）。揃っていないと、反映の途中で数秒の 503 が出うる。
  # `auth_cognito` には依存させない（コールバック URL が CloudFront を参照するため、循環になる）。
  depends_on = [aws_ssm_parameter.ip_allowlist, aws_ssm_parameter.auth_mode, aws_iam_role_policy.edge_auth_ssm]
}
