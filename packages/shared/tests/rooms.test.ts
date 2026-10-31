import { describe, expect, it } from "vitest";
import { branchOf, roomOf } from "../src/rooms";

describe("branch and room splitting", () => {
  it("splits branch from room on the first ' at '", () => {
    expect(branchOf("North Gloucester at Room A")).toBe("North Gloucester");
    expect(roomOf("North Gloucester at Room A")).toBe("Room A");
    expect(branchOf("Greely at Carol Parker Room")).toBe("Greely");
    expect(roomOf("Greely at Carol Parker Room")).toBe("Carol Parker Room");
  });

  it("treats room-less names as the whole branch", () => {
    expect(branchOf("Canadian War Museum")).toBe("Canadian War Museum");
    expect(roomOf("Canadian War Museum")).toBeNull();
    expect(roomOf("Westboro Market, Byron Linear Park")).toBeNull();
  });

  it("handles nulls and empty rooms", () => {
    expect(branchOf(null)).toBe("");
    expect(roomOf(null)).toBeNull();
    expect(roomOf("Branch at ")).toBeNull();
    expect(roomOf("Branch at")).toBeNull();
  });

  it("keeps later ' at ' inside the room", () => {
    expect(branchOf("Main at Meet at the Desk")).toBe("Main");
    expect(roomOf("Main at Meet at the Desk")).toBe("Meet at the Desk");
  });
});
