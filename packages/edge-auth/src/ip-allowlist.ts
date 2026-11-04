/**
 * IP 許可リスト（FR-6.2）の解釈と判定。純粋関数だけを持ち、AWS SDK に依存しない。
 *
 * 許可リストは SSM のパラメータに置く。書式は IPv4 アドレスまたは CIDR をカンマ区切りで並べたもの:
 *   `203.0.113.0/24,198.51.100.7`
 * CIDR を付けない要素は、その 1 つだけを許可する（`/32`）。
 *
 * 判定は符号なし 32 ビット整数で行う。JavaScript のビット演算は符号付き 32 ビットで評価されるので、
 * 結果は必ず `>>> 0` で符号なしに戻す。また、シフト量は 32 で割った余りに丸められるため、
 * `/0` を `0xffffffff << 32` で作ると全ビットが立つ。`/0` は別扱いにする。
 */

export interface Cidr {
  /** ネットワークアドレス（符号なし 32 ビット）。ホストビットは 0。 */
  network: number;
  /** ネットマスク（符号なし 32 ビット）。 */
  mask: number;
}

/** 先頭に 0 を付けない 10 進（`010` は 8 進と読む実装があり、食い違うので不正にする）。 */
const OCTET = /^(0|[1-9]\d{0,2})$/;
const PREFIX = /^(0|[1-9]\d?)$/;

/** 厳密な IPv4 のドット区切りを 0〜2^32-1 の数にする。読めなければ null。 */
function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value;
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

function parseEntry(entry: string): Cidr {
  const [address, prefixText, ...rest] = entry.split("/");
  const ip = address === undefined ? null : parseIpv4(address);
  if (ip === null || rest.length > 0) {
    throw new Error(`許可リストの要素 "${entry}" が IPv4 アドレスまたは CIDR ではありません`);
  }

  let prefix = 32;
  if (prefixText !== undefined) {
    if (!PREFIX.test(prefixText) || Number(prefixText) > 32) {
      throw new Error(`許可リストの要素 "${entry}" のプレフィックスが 0〜32 の整数ではありません`);
    }
    prefix = Number(prefixText);
  }

  const mask = maskOf(prefix);
  return { network: (ip & mask) >>> 0, mask };
}

/**
 * 許可リストを解釈する。1 要素でも不正なら例外にする（一部だけを有効にして、
 * 意図しない範囲を許可・拒否することを避ける）。
 */
export function parseAllowlist(value: string): Cidr[] {
  return value.split(",").map((entry) => parseEntry(entry.trim()));
}

/** `clientIp` が許可リストのいずれかに含まれるか。IPv4 でなければ false。 */
export function isAllowed(clientIp: string | undefined, list: readonly Cidr[]): boolean {
  if (clientIp === undefined) {
    return false;
  }
  const ip = parseIpv4(clientIp);
  if (ip === null) {
    return false;
  }
  return list.some((cidr) => ((ip & cidr.mask) >>> 0) === cidr.network);
}
