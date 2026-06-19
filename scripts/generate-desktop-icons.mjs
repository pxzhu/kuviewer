import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourceIcon = path.join(repoRoot, 'website/public/images/brand/kuviewer-icon-yaml-flow.png');
const iconDir = path.join(repoRoot, 'desktop/src-tauri/icons');
const pngOutputs = [
  { size: 32, file: '32x32.png' },
  { size: 128, file: '128x128.png' },
  { size: 256, file: '128x128@2x.png' },
  { size: 256, file: 'icon.png' },
];

const icnsOutputs = [
  { type: 'icp4', size: 16 },
  { type: 'icp5', size: 32 },
  { type: 'icp6', size: 64 },
  { type: 'ic07', size: 128 },
  { type: 'ic08', size: 256 },
  { type: 'ic09', size: 512 },
  { type: 'ic10', size: 1024 },
];

await mkdir(iconDir, { recursive: true });
await rm(path.join(iconDir, 'kuviewer.iconset'), { recursive: true, force: true });

for (const output of pngOutputs) {
  await resizePng(output.size, path.join(iconDir, output.file));
}

const icnsImages = [];
for (const output of icnsOutputs) {
  const pngPath = path.join(iconDir, `.icon-${output.size}.png`);
  await resizePng(output.size, pngPath);
  icnsImages.push({
    type: output.type,
    png: await readFile(pngPath),
  });
  await rm(pngPath, { force: true });
}

await writeIcns(path.join(iconDir, 'icon.icns'), icnsImages);

await writeIco(
  path.join(iconDir, 'icon.ico'),
  await Promise.all([
    readFile(path.join(iconDir, '32x32.png')),
    readFile(path.join(iconDir, '128x128.png')),
    readFile(path.join(iconDir, '128x128@2x.png')),
  ])
);

console.log(`generated desktop icons in ${path.relative(repoRoot, iconDir)}`);

async function resizePng(size, outputPath) {
  await execFileAsync('sips', ['-z', String(size), String(size), sourceIcon, '--out', outputPath]);
}

async function writeIco(outputPath, images) {
  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + entrySize * images.length;
  let imageOffset = directorySize;

  const header = Buffer.alloc(directorySize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  images.forEach((image, index) => {
    const dimensions = readPngDimensions(image);
    const entryOffset = headerSize + entrySize * index;
    header.writeUInt8(dimensions.width >= 256 ? 0 : dimensions.width, entryOffset);
    header.writeUInt8(dimensions.height >= 256 ? 0 : dimensions.height, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.length;
  });

  await writeFile(outputPath, Buffer.concat([header, ...images]));
}

async function writeIcns(outputPath, images) {
  const chunks = images.map(({ type, png }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const totalLength = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);
  await writeFile(outputPath, Buffer.concat([header, ...chunks]));
}

function readPngDimensions(file) {
  const pngSignature = '89504e470d0a1a0a';
  if (file.length < 24 || file.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('icon source must be PNG');
  }
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
  };
}
