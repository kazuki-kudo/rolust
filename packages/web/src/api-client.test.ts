import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client.js";

/** 乖離を直す 2 つの呼び出しが、決めた method・path・本文で API を呼ぶことを確かめる（Issue #172）。 */
describe("api の乖離を直す呼び出し", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ outcome: "no-drift", changeRequest: null, exclusion: null, failures: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const roleArn = "arn:aws:iam::123456789012:role/app";

  it("restoreDrift は POST /drift/restore に { roleArn } を送る", async () => {
    const fetchMock = stubFetch();
    const result = await api.restoreDrift(roleArn);
    expect(result.outcome).toBe("no-drift");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/drift\/restore$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ roleArn });
  });

  it("adoptDrift は POST /drift/adopt に { roleArn } を送る", async () => {
    const fetchMock = stubFetch();
    await api.adoptDrift(roleArn);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/drift\/adopt$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ roleArn });
  });
});
