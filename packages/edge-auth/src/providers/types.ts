import type { CloudFrontRequest, CloudFrontResultResponse } from "aws-lambda";

/** 通すなら `request` を、拒否・リダイレクトなら応答を返す。 */
export type AuthResult = CloudFrontRequest | CloudFrontResultResponse;

/** 認証プロバイダー。IP 許可リストの判定（FR-6.2）の後に呼ばれる。 */
export type AuthProvider = (request: CloudFrontRequest) => Promise<AuthResult>;
