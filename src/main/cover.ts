export const COVER_MIN = 120
export const COVER_MAX = 640
export const COVER_DEFAULT = 260

export type Corner = 'nw' | 'ne' | 'sw' | 'se'
export interface Square {
  x: number
  y: number
  size: number
}

export const clampSize = (size: number): number => Math.round(Math.max(COVER_MIN, Math.min(COVER_MAX, size)))

/**
 * Resizes a square by dragging one corner: the opposite corner stays put and the window stays 1:1.
 * dx/dy are how far the pointer has moved since the drag started.
 */
export function resizeSquare(start: Square, corner: Corner, dx: number, dy: number): Square {
  const west = corner === 'nw' || corner === 'sw'
  const north = corner === 'nw' || corner === 'ne'
  // Growth along the corner's outward diagonal; averaging both axes keeps the drag feeling natural
  const grow = ((west ? -dx : dx) + (north ? -dy : dy)) / 2
  const size = clampSize(start.size + grow)
  return {
    size,
    x: west ? start.x + start.size - size : start.x,
    y: north ? start.y + start.size - size : start.y
  }
}
