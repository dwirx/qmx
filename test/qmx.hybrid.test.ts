import { describe, expect, test } from "bun:test";
import { fuseRrf } from "../src/lib/search";

describe("hybrid fusion", () => {
  test("prioritizes docs that rank high in both channels", () => {
    const fused = fuseRrf(
      [
        { key: "a", score: 0.9 },
        { key: "b", score: 0.8 },
        { key: "c", score: 0.7 },
      ],
      [
        { key: "b", score: 0.95 },
        { key: "a", score: 0.5 },
        { key: "d", score: 0.3 },
      ],
      60
    );

    expect(fused[0]?.key).toBe("b");
    expect(fused.some((x) => x.key === "d")).toBe(true);
  });
});
