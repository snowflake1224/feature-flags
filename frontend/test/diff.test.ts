import { describe, expect, it } from "vitest";
import { diffRecords, formatDiffValue } from "../lib/diff";

describe("diffRecords", () => {
  it("lists changed paths before unchanged ones", () => {
    expect(diffRecords({ on: false, name: "checkout" }, { on: true, name: "checkout" })).toEqual([
      { path: "on", before: "false", after: "true" },
      { path: "name", before: "checkout", after: "checkout" },
    ]);
  });

  it("flattens nested objects and arrays", () => {
    const rows = diffRecords(
      { rules: [{ id: "a", weight: 10 }] },
      { rules: [{ id: "b", weight: 10 }], added: 1 },
    );
    expect(rows.find((row) => row.path === "rules[0].id")).toEqual({
      path: "rules[0].id",
      before: "a",
      after: "b",
    });
    expect(rows.find((row) => row.path === "added")).toEqual({
      path: "added",
      before: "—",
      after: "1",
    });
    expect(rows[0].path).toBe("added");
  });

  it("formats missing values with an em dash", () => {
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue("plain")).toBe("plain");
  });
});
