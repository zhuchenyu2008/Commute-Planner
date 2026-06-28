import { describe, expect, it } from "vitest";
import { normalizeRouteTitle } from "@/lib/trips/title";

describe("normalizeRouteTitle", () => {
  it("prefers explicit endpoints over the raw title", () => {
    expect(
      normalizeRouteTitle({
        title: "明天10:00 外事学校到东钱湖地铁站",
        originName: "外事学校",
        destinationName: "东钱湖地铁站",
      })
    ).toBe("外事学校-东钱湖地铁站");
  });

  it("falls back to the provided title when endpoints are missing", () => {
    expect(normalizeRouteTitle({ title: "临时行程" })).toBe("临时行程");
  });

  it("preserves internal spaces in endpoint names", () => {
    expect(
      normalizeRouteTitle({
        title: "机场路线",
        originName: "T3 航站楼",
        destinationName: "Hong Kong Station",
      })
    ).toBe("T3 航站楼-Hong Kong Station");
  });
});
