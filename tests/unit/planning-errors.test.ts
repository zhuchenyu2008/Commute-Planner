import { describe, expect, it } from "vitest";
import {
  AgentRunTimeoutError,
  formatPlanningFailureMessage,
} from "@/lib/agent/planner";

describe("planning error display", () => {
  it("formats internal planning errors without leaking English implementation details", () => {
    expect(formatPlanningFailureMessage(new AgentRunTimeoutError(600000))).toBe(
      "规划失败：智能体规划超时，请稍后重试。"
    );

    expect(formatPlanningFailureMessage(new Error("Agent run aborted."))).toBe(
      "规划失败：智能体运行已中止。"
    );

    expect(
      formatPlanningFailureMessage(
        new Error("timeoutMs must be greater than zero.")
      )
    ).toBe("规划失败：内部运行超时配置无效。");
  });
});
