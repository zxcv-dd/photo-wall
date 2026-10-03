export declare global {

  // Javascript Object Enhancement
  interface Array<T> {
    first: T | undefined
    last: T | undefined
  }

  // Global Types
  interface Size {
    slot?: number
    width: number
    height: number
    fullWidth?: number
    fullHeight?: number
  }

  interface Point {
    x: number,
    y: number
  }

  interface Rect {
    top: number
    left: number
    angle: number
    width: number
    height: number
    fullWidth?: number
    fullHeight?: number
  }

  interface Pic {
    date: string
    width: number
    height: number
    aspectRatio: number
    title?: string
    desc?: string
    // Optional album section. Encoded in the filename as the dot segment between
    // the dimensions and the extension: `2025-05-12.2048×1536.开幕式.jpg`.
    // Webpack's content hash and the pipeline's `.2` counter are stripped out.
    category?: string
    path: string
  }
}
