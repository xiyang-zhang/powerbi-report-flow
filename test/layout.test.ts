import { describe, expect, it } from "vitest";
import { gridRect } from "../src/report/layout";

describe("gridRect", () => {
  it("maps the full 12x12 grid to the canvas minus margins", () => {
    const rect = gridRect({ width: 1280, height: 720 }, [1, 1, 12, 12], { marginX: 24, marginY: 20 });
    expect(rect.x).toBe(24);
    expect(rect.y).toBe(20);
    expect(rect.width).toBe(1232);
    expect(rect.height).toBe(680);
  });

  it("splits the grid into two half-width cells with a gutter", () => {
    const left = gridRect({ width: 1280, height: 720 }, [1, 1, 6, 6], { marginX: 24, marginY: 20, gutterX: 8 });
    const right = gridRect({ width: 1280, height: 720 }, [7, 1, 12, 6], { marginX: 24, marginY: 20, gutterX: 8 });
    expect(left.width).toBeGreaterThan(500);
    expect(right.x).toBeGreaterThan(left.x + left.width);
  });
});
