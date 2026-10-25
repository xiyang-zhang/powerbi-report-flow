import type { PageSpec, PlacementSpec } from "../core/types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutOptions {
  marginX?: number;
  marginY?: number;
  gutterX?: number;
  gutterY?: number;
  columns?: number;
  rows?: number;
}

export function gridRect(
  canvas: { width: number; height: number },
  region: [number, number, number, number],
  options: LayoutOptions = {},
): Rect {
  const marginX = options.marginX ?? 24;
  const marginY = options.marginY ?? 20;
  const gutterX = options.gutterX ?? 8;
  const gutterY = options.gutterY ?? 8;
  const columns = options.columns ?? 12;
  const rows = options.rows ?? 12;

  const [c1, r1, c2, r2] = region;
  const left = Math.max(1, Math.min(columns, Math.min(c1, c2)));
  const right = Math.max(1, Math.min(columns, Math.max(c1, c2)));
  const top = Math.max(1, Math.min(rows, Math.min(r1, r2)));
  const bottom = Math.max(1, Math.min(rows, Math.max(r1, r2)));

  const cellWidth = (canvas.width - marginX * 2 - gutterX * (columns - 1)) / columns;
  const cellHeight = (canvas.height - marginY * 2 - gutterY * (rows - 1)) / rows;

  return {
    x: Math.round(marginX + (left - 1) * (cellWidth + gutterX)),
    y: Math.round(marginY + (top - 1) * (cellHeight + gutterY)),
    width: Math.max(64, Math.round((right - left + 1) * cellWidth + (right - left) * gutterX)),
    height: Math.max(40, Math.round((bottom - top + 1) * cellHeight + (bottom - top) * gutterY)),
  };
}

export function layoutPage(page: PageSpec): Array<{ placement: PlacementSpec; rect: Rect }> {
  return page.placements.map((placement) => {
    if (placement.position) return { placement, rect: placement.position };
    const region = page.regions[placement.region];
    if (!region) {
      return { placement, rect: gridRect(page.canvas, [1, 1, 12, 12]) };
    }
    return { placement, rect: gridRect(page.canvas, region) };
  });
}

export function clampRect(rect: Rect, canvas: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.min(canvas.width - 24, Math.round(rect.x)));
  const y = Math.max(0, Math.min(canvas.height - 24, Math.round(rect.y)));
  return {
    x,
    y,
    width: Math.max(24, Math.min(canvas.width - x, Math.round(rect.width))),
    height: Math.max(24, Math.min(canvas.height - y, Math.round(rect.height))),
  };
}
