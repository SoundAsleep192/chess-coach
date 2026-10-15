export interface Bitmap {
  width: number;
  height: number;
  /** 1 - чёрный пиксель, по байту на пиксель. */
  data: Uint8Array;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Component extends Rect {
  pixels: number;
}

const isSpace = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/** Двоичный PBM (P4), как его пишут pdfimages и pdftoppm -mono. */
export function readPbm(buf: Buffer): Bitmap {
  let pos = 0;
  const token = (): string => {
    for (;;) {
      while (pos < buf.length && isSpace(buf[pos])) pos++;
      if (buf[pos] !== 0x23) break;
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
    }
    const start = pos;
    while (pos < buf.length && !isSpace(buf[pos])) pos++;
    return buf.toString('ascii', start, pos);
  };
  if (token() !== 'P4') throw new Error('not a binary PBM (P4)');
  const width = Number(token());
  const height = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('bad PBM header');
  pos += 1;
  const rowBytes = Math.ceil(width / 8);
  if (pos + rowBytes * height > buf.length) throw new Error('truncated PBM');
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = pos + y * rowBytes;
    for (let x = 0; x < width; x++) data[y * width + x] = (buf[row + (x >> 3)] >> (7 - (x & 7))) & 1;
  }
  return { width, height, data };
}

export function writePbm(bmp: Bitmap): Buffer {
  const rowBytes = Math.ceil(bmp.width / 8);
  const body = Buffer.alloc(rowBytes * bmp.height);
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) if (bmp.data[y * bmp.width + x]) body[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return Buffer.concat([Buffer.from(`P4\n${bmp.width} ${bmp.height}\n`, 'ascii'), body]);
}

export function blank(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height) };
}

/** Вырезать прямоугольник; то, что за краем страницы, - белое. */
export function crop(bmp: Bitmap, r: Rect): Bitmap {
  const out = blank(r.w, r.h);
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y;
    if (sy < 0 || sy >= bmp.height) continue;
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x;
      if (sx >= 0 && sx < bmp.width) out.data[y * r.w + x] = bmp.data[sy * bmp.width + sx];
    }
  }
  return out;
}

export function countBlack(bmp: Bitmap, r: Rect): number {
  let n = 0;
  for (let y = Math.max(0, r.y); y < Math.min(bmp.height, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(bmp.width, r.x + r.w); x++) n += bmp.data[y * bmp.width + x];
  }
  return n;
}

/** Рамка чёрных пикселей внутри r или null, если там пусто. */
export function blackBBox(bmp: Bitmap, r: Rect): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = Math.max(0, r.y); y < Math.min(bmp.height, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(bmp.width, r.x + r.w); x++) {
      if (!bmp.data[y * bmp.width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Связные компоненты чёрных пикселей, 4-соседство. */
export function components(bmp: Bitmap): Component[] {
  const { width: W, height: H, data } = bmp;
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  const out: Component[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!data[i] || seen[i]) continue;
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    let pixels = 0;
    while (top > 0) {
      const j = stack[--top];
      const x = j % W;
      const y = (j - x) / W;
      pixels += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const push = (k: number) => {
        if (data[k] && !seen[k]) {
          seen[k] = 1;
          stack[top++] = k;
        }
      };
      if (x > 0) push(j - 1);
      if (x < W - 1) push(j + 1);
      if (y > 0) push(j - W);
      if (y < H - 1) push(j + W);
    }
    out.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, pixels });
  }
  return out;
}
