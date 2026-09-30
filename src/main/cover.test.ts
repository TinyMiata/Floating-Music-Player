import { describe, expect, it } from 'vitest'
import { clampSize, COVER_MAX, COVER_MIN, resizeSquare } from './cover'

const start = { x: 100, y: 100, size: 200 }

describe('resizeSquare', () => {
  it('grows from the bottom-right corner keeping the top-left fixed', () => {
    expect(resizeSquare(start, 'se', 40, 40)).toEqual({ x: 100, y: 100, size: 240 })
  })
  it('grows from the top-left corner keeping the bottom-right fixed', () => {
    expect(resizeSquare(start, 'nw', -40, -40)).toEqual({ x: 60, y: 60, size: 240 })
  })
  it('keeps the opposite corner fixed for ne and sw', () => {
    expect(resizeSquare(start, 'ne', 30, -30)).toEqual({ x: 100, y: 70, size: 230 })
    expect(resizeSquare(start, 'sw', -30, 30)).toEqual({ x: 70, y: 100, size: 230 })
  })
  it('stays square when the pointer moves on one axis only', () => {
    expect(resizeSquare(start, 'se', 60, 0).size).toBe(230)
  })
  it('clamps to the min and max size, moving the origin accordingly', () => {
    expect(resizeSquare(start, 'nw', 500, 500)).toEqual({ x: 180, y: 180, size: COVER_MIN })
    expect(resizeSquare(start, 'se', 900, 900).size).toBe(COVER_MAX)
  })
})

describe('clampSize', () => {
  it('rounds and clamps', () => {
    expect(clampSize(10)).toBe(COVER_MIN)
    expect(clampSize(1000)).toBe(COVER_MAX)
    expect(clampSize(250.6)).toBe(251)
  })
})
