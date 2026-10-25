import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodePng, type PixelStrip } from './png';

function decode(bytes: Uint8Array) {
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: string[] = [], compressed: Uint8Array[] = [];
  let width = 0, height = 0, offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= value;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    expect(view.getUint32(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0);
    chunks.push(type);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  expect(offset).toBe(bytes.length);
  expect(chunks[0]).toBe('IHDR'); expect(chunks.at(-1)).toBe('IEND');
  expect(chunks.slice(chunks.indexOf('IDAT'), -1).every(type => type === 'IDAT')).toBe(true);
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * 4;
  expect(raw.length).toBe((stride + 1) * height);
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const input = row * (stride + 1), output = row * stride;
    expect(raw[input]).toBe(1);
    for (let index = 0; index < stride; index++) {
      pixels[output + index] = raw[input + index + 1] + (index >= 4 ? pixels[output + index - 4] : 0);
    }
  }
  return { width, height, pixels, chunks };
}

async function* split(data: Uint8ClampedArray, width: number, stripHeight: number): AsyncGenerator<PixelStrip> {
  for (let offset = 0; offset < data.length; offset += width * stripHeight * 4) {
    const pixels = data.slice(offset, offset + width * stripHeight * 4);
    yield { height: pixels.length / (width * 4), data: pixels };
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('流式单张PNG', () => {
  it('按完整PNG格式编码，CRC全部有效，跨绘制条带保持每个RGBA像素且只有一个zlib流', async () => {
    const width = 127, height = 130, original = new Uint8ClampedArray(width * height * 4);
    let random = 123456;
    for (let index = 0; index < original.length; index++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      original[index] = random >>> 24;
    }
    const blob = await encodePng(width, height, split(original, width, 17));
    expect(blob.type).toBe('image/png');
    const result = decode(new Uint8Array(await blob.arrayBuffer()));
    expect(result).toMatchObject({ width, height });
    expect(result.chunks.filter(type => type === 'IDAT').length).toBeGreaterThan(1);
    expect(result.pixels).toEqual(new Uint8Array(original));
  });

  it('超过9000和65535像素高仍编码为单张图，首尾行完整连续', async () => {
    const width = 2, height = 65540, original = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      original.set([row & 255, (row >>> 8) & 255, 17, 255, 12, 34, 56, 78], row * 8);
    }
    const result = decode(new Uint8Array(await (await encodePng(width, height, split(original, width, 1024))).arrayBuffer()));
    expect(result.height).toBe(height);
    expect(result.pixels).toEqual(new Uint8Array(original));
  });

  it('拒绝缺行、多行或错误像素长度，禁止输出表面成功的残缺图片', async () => {
    await expect(encodePng(2, 3, split(new Uint8ClampedArray(16), 2, 1))).rejects.toThrow('不完整');
    await expect(encodePng(2, 1, split(new Uint8ClampedArray(16), 2, 1))).rejects.toThrow('不完整');
    async function* malformed() { yield { height: 1, data: new Uint8ClampedArray(7) }; }
    await expect(encodePng(2, 1, malformed())).rejects.toThrow('不完整');
  });

  it('取消会终止生产并释放生成器，已取消的任务不再启动', async () => {
    const controller = new AbortController(); let cleaned = false;
    async function* render() {
      try {
        yield { height: 1, data: new Uint8ClampedArray(8) };
        controller.abort(); controller.signal.throwIfAborted();
        yield { height: 1, data: new Uint8ClampedArray(8) };
      } finally { cleaned = true; }
    }
    await expect(encodePng(2, 2, render(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cleaned).toBe(true);
    await expect(encodePng(2, 1, render(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('不支持压缩API时明确报错，而不是拆图或生成空文件', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    await expect(encodePng(1, 1, split(new Uint8ClampedArray(4), 1, 1))).rejects.toThrow('更新浏览器');
  });
});
