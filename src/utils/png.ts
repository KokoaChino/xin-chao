export interface PixelStrip {
  height: number;
  data: Uint8ClampedArray;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function chunk(type: string, data = new Uint8Array()): ArrayBuffer {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) bytes[index + 4] = type.charCodeAt(index);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < bytes.length - 4; index++) crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes.buffer;
}

// PNG has one zlib stream across all IDAT chunks, regardless of rendering strip boundaries.
export async function encodePng(
  width: number, height: number, strips: AsyncIterable<PixelStrip>, signal?: AbortSignal,
): Promise<Blob> {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 0x7fffffff)) {
    throw new Error('海报尺寸无效。');
  }
  signal?.throwIfAborted();
  if (typeof CompressionStream === 'undefined') throw new Error('当前浏览器不支持长图导出，请更新浏览器后重试。');

  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = 6; // Eight-bit RGBA, no interlacing.
  const parts: BlobPart[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('sRGB', new Uint8Array([0])),
  ];
  const iterator = strips[Symbol.asyncIterator]();
  let rows = 0;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      try {
        signal?.throwIfAborted();
        const next = await iterator.next();
        signal?.throwIfAborted();
        if (next.done) {
          if (rows !== height) throw new Error('海报内容不完整，请重新生成。');
          controller.close(); return;
        }
        const strip = next.value, stride = width * 4;
        if (!Number.isInteger(strip.height) || strip.height < 1 || rows + strip.height > height || strip.data.length !== stride * strip.height) {
          throw new Error('海报像素数据不完整，请重新生成。');
        }
        const filtered = new Uint8Array((stride + 1) * strip.height);
        for (let row = 0; row < strip.height; row++) {
          const input = row * stride, output = row * (stride + 1);
          filtered[output] = 1; // Sub filtering uses only pixels in the current row.
          for (let index = 0; index < stride; index++) {
            filtered[output + index + 1] = strip.data[input + index] - (index >= 4 ? strip.data[input + index - 4] : 0);
          }
        }
        rows += strip.height;
        controller.enqueue(filtered);
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return?.(); },
  }, { highWaterMark: 0 });
  const reader = source.pipeThrough(new CompressionStream('deflate'), { signal }).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      parts.push(chunk('IDAT', value));
    }
    parts.push(chunk('IEND'));
    return new Blob(parts, { type: 'image/png' });
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await iterator.return?.();
  }
}
