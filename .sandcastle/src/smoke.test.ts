import { describe, expect, it } from "vitest";
import { pruneClosure, waveLevels, type StackStep } from "./stack.ts";

// Pipeline smoke spec: proves Vitest resolves the factory's modules
// (`.ts`-extension ESM imports, scoped tsconfig) end to end. Real
// coverage of the graph functions lands in a follow-up ticket.

function step(number: number, dependsOn: number[]): StackStep {
  return {
    issue: { number, title: `Issue ${number}` },
    branch: `sandcastle/issue-${number}`,
    base: "main",
    dependsOn,
  };
}

describe("smoke", () => {
  it("waveLevels groups steps by dependency depth", () => {
    const stack = [step(1, []), step(2, [1]), step(3, [1])];
    const levels = waveLevels(stack);
    expect(levels.map((level) => level.map((s) => s.issue.number))).toEqual([
      [1],
      [2, 3],
    ]);
  });

  it("pruneClosure takes transitive dependents with the seed", () => {
    const stack = [step(1, []), step(2, [1]), step(3, [2]), step(4, [])];
    expect(pruneClosure(stack, [2])).toEqual(new Set([2, 3]));
  });
});
