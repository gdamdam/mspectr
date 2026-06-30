/**
 * Minimal ambient declaration for Node's `Buffer`, used only as a base64
 * fallback in the sharing codec when the browser's atob/btoa are unavailable
 * (i.e. the node test environment). We declare just the surface used rather than
 * pulling all of @types/node into a browser app — which would shadow DOM timer
 * return types and other globals.
 */
declare const Buffer: {
  from(data: ArrayLike<number> | ArrayBufferLike, encoding?: string): Uint8Array & {
    toString(encoding?: string): string
  }
  from(data: string, encoding?: string): Uint8Array & {
    toString(encoding?: string): string
  }
}
