// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider, useLocale, useT } from "./LocaleProvider.js";

function Probe(): React.JSX.Element {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="title">{t.app.documentTitle}</span>
      <button onClick={() => setLocale("en")}>to-en</button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.lang = "ja";
  document.title = "";
});

describe("LocaleProvider", () => {
  it("Provider が無いときは日本語（既存のテストを変えないための既定）", () => {
    render(<Probe />);
    expect(screen.getByTestId("locale").textContent).toBe("ja");
  });

  it("initialLocale で言語を決め、<html lang> と document.title を合わせる", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe(screen.getByTestId("title").textContent);
    expect(document.title).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/);
  });

  describe("initialLocale を省略すると、Provider が自分で言語を決める", () => {
    const noStorage = { getItem: () => null, setItem: () => undefined };

    it("保存した言語があれば、それを使う（ブラウザの言語より先）", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"]);
      render(
        <LocaleProvider storage={{ getItem: () => "en", setItem: () => undefined }}>
          <Probe />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("locale").textContent).toBe("en");
    });

    it("保存が無ければ、ブラウザの言語が日本語なら ja", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"]);
      render(
        <LocaleProvider storage={noStorage}>
          <Probe />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("locale").textContent).toBe("ja");
    });

    it("保存が無ければ、ブラウザの言語が英語なら en", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
      render(
        <LocaleProvider storage={noStorage}>
          <Probe />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("locale").textContent).toBe("en");
    });

    it("navigator.languages が空配列なら、navigator.language を見る（ja-JP は ja）", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
      vi.spyOn(navigator, "language", "get").mockReturnValue("ja-JP");
      render(
        <LocaleProvider storage={noStorage}>
          <Probe />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("locale").textContent).toBe("ja");
    });

    it("navigator.languages が空配列なら、navigator.language を見る（en-US は en）", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue([]);
      vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
      render(
        <LocaleProvider storage={noStorage}>
          <Probe />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("locale").textContent).toBe("en");
    });

    it("navigator.languages も navigator.language も無ければ en", () => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue(undefined as unknown as readonly string[]);
      vi.spyOn(navigator, "language", "get").mockReturnValue(undefined as unknown as string);
      render(
        <LocaleProvider storage={noStorage}>
          <Probe />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("locale").textContent).toBe("en");
    });
  });

  it("切り替えると、表示・<html lang>・保存が変わる", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };
    render(
      <LocaleProvider initialLocale="ja" storage={storage}>
        <Probe />
      </LocaleProvider>,
    );
    act(() => screen.getByText("to-en").click());
    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(memory.get("rolust.locale")).toBe("en");
  });
});
