export type ViewportAppState = {
  zoom: number;
  scrollX: number;
  scrollY: number;
};

export type Point = { x: number; y: number };

/**
 * Convert scene coordinates to viewport coordinates, relative to the
 * Excalidraw canvas container. We intentionally skip offsetLeft/offsetTop
 * because our overlay lives inside the same wrapper as the canvas.
 */
export function sceneToViewport(p: Point, s: ViewportAppState): Point {
  return {
    x: (p.x + s.scrollX) * s.zoom,
    y: (p.y + s.scrollY) * s.zoom,
  };
}

export const DEFAULT_VIEWPORT_STATE: ViewportAppState = {
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
};
