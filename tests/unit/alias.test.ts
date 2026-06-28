import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/project";

describe("test aliases", () => {
  it("resolves src aliases from the project root", () => {
    expect(APP_NAME).toBe("commute-planner");
  });
});
