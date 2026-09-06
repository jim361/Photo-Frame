import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const between = (start, end) => {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  assert(a >= 0 && b > a, `검사할 소스를 찾지 못했습니다: ${start}`);
  return html.slice(a, b);
};
const fields = { dateFormat:{ value:'original' }, metadataVisibility:{ children:[] } };
const $ = id => fields[id] ||= { placeholder:'' };
const code = [
  between('function dateText(o){', '/* 입력 필드는'),
  between("const INFO_KEYS =", 'function syncScopeUi(){'),
  between('function adoptDetectedExif(shot){', 'function syncFields(){'),
  between('async function readExif(file){', 'async function loadImage(file){'),
].join('\n');
const api = new Function('$', `${code}; return { dateText, exposureText, displayMetadata,
  metadataOptions, loadMetadataSettings, readExif, applyDetectedExif, adoptDetectedExif,
  shotValue, withShot, gInfo, gShow };`)($);

// 작은 실제 APP1/TIFF 구조로 파서와 자동/수동 채택 경계를 함께 검증한다.
function jpegExif(values){
  const bytes = new Uint8Array(4096), v = new DataView(bytes.buffer), t = 12;
  v.setUint16(0, 0xffd8); v.setUint16(2, 0xffe1);
  bytes.set([69,120,105,102,0,0], 6);
  v.setUint16(t, 0x4949); v.setUint16(t + 2, 42, true); v.setUint32(t + 4, 8, true);
  let next = 512;
  function ifd(at, entries){
    v.setUint16(t + at, entries.length, true);
    entries.forEach(([tag, type, value], i) => {
      const e = t + at + 2 + i * 12;
      v.setUint16(e, tag, true); v.setUint16(e + 2, type, true);
      const data = type === 2 ? new TextEncoder().encode(value + '\0') : null;
      v.setUint32(e + 4, data ? data.length : 1, true);
      if (type === 2){
        if (data.length <= 4) bytes.set(data, e + 8);
        else { v.setUint32(e + 8, next, true); bytes.set(data, t + next); next += data.length; }
      } else if (type === 5){
        v.setUint32(e + 8, next, true);
        v.setUint32(t + next, value[0], true); v.setUint32(t + next + 4, value[1], true); next += 8;
      } else if (type === 3) v.setUint16(e + 8, value, true);
      else v.setUint32(e + 8, value, true);
    });
  }
  const top = [[0x8769, 4, 128]], exif = [];
  for (const [key, tag] of [['make',0x010f],['model',0x0110],['software',0x0131]])
    if (values[key]) top.push([tag, 2, values[key]]);
  for (const [key, tag] of [['date',0x9003],['lens',0xa434]])
    if (values[key]) exif.push([tag, 2, values[key]]);
  for (const [key, tag] of [['aperture',0x829d],['shutter',0x829a],['focal',0x920a]])
    if (values[key]) exif.push([tag, 5, values[key]]);
  if (values.iso) exif.push([0x8827, 3, values.iso]);
  ifd(8, top); ifd(128, exif);
  v.setUint16(4, t + next - 4);
  return new Blob([bytes.slice(0, t + next)], { type:'image/jpeg' });
}

const partial = await api.readExif(jpegExif({ make:'Canon', model:'EOS R6', date:'2026:07:19 12:00:00' }));
assert.equal(partial.camera, 'Canon EOS R6');
assert.equal(partial.date, '2026.07.19');
const shot = { own:{ body:'수동 카메라', date:null } };
api.gInfo.date = '직접 입력한 날짜';
assert.equal(api.applyDetectedExif(shot, partial), false);
assert.equal(shot.exif, undefined);
assert.equal(shot.exifReview, 'partial');
assert.equal(shot.detectedExif.body, 'Canon EOS R6');
assert.equal(api.adoptDetectedExif(shot), true);
assert.equal(shot.detectedExif, undefined);
assert.equal(api.shotValue(shot, 'body'), '수동 카메라');
assert.equal(api.shotValue(shot, 'date'), '직접 입력한 날짜');
assert.equal(api.adoptDetectedExif(shot), false);

const dateOnly = await api.readExif(jpegExif({ date:'2026:07:19 12:00:00' }));
const dateShot = {};
assert.equal(api.applyDetectedExif(dateShot, dateOnly), false);
assert.deepEqual(dateShot.detectedExif, { date:'2026.07.19' });
api.adoptDetectedExif(dateShot);
assert.equal(api.shotValue(dateShot, 'date'), '2026.07.19');

const full = await api.readExif(jpegExif({ make:'Nikon', model:'Z 6', lens:'50mm F1.8',
  date:'2026:07:19 12:00:00', aperture:[18,10], shutter:[1,250], iso:400, focal:[50,1] }));
assert.equal(full.set, 'F1.8 · 1/250s · ISO 400 · 50mm');
const digital = {};
assert.equal(api.applyDetectedExif(digital, full), true);
assert.equal(digital.exif.set, full.set);
for (const scannerValues of [{ make:'EPSON', model:'V850' }, { make:'Canon', software:'VueScan' }]){
  const x = await api.readExif(jpegExif({ ...scannerValues, aperture:[8,1] }));
  const scan = {};
  assert.equal(api.applyDetectedExif(scan, x), false);
  assert.equal(scan.exifReview, 'scanner');
  assert.equal(api.adoptDetectedExif(scan), true);
  assert.equal(scan.exif.set, 'F8');
}
assert.equal(await api.readExif(new Blob(['broken'], {type:'image/jpeg'})), null);
assert.equal(await api.readExif(new Blob(['broken'], {type:'image/png'})), null);

const original = { set:'F1.8 · 1/250s · ISO 400 · 50mm', metadataShow:{ iso:false, focal:false } };
assert.equal(api.exposureText(original), 'F1.8 · 1/250s');
assert.equal(api.displayMetadata(original).set, 'F1.8 · 1/250s');
assert.equal(original.set, full.set);
assert.equal(api.exposureText({set:'  F2 · ISO 100  '}), '  F2 · ISO 100  ');
assert.equal(api.exposureText({set:'ISO film pushed +1',metadataShow:{iso:false}}), 'ISO film pushed +1');
assert.equal(api.exposureText({set:'F2',metadataShow:{aperture:false}}), '');
assert.equal(api.exposureText({set:'F2 · 1/125s · ISO 100 · 35mm',metadataShow:{aperture:false,shutter:false,iso:false,focal:false}}), '');

const date = (value, format) => api.dateText({show:{date:true},date:value,dateFormat:format});
assert.equal(date('2026.7.9', 'hyphen'), '2026-07-09');
assert.equal(date('2026-07-19', 'dots'), '2026.07.19');
assert.equal(date('2026/07/19', 'korean'), '2026년 7월 19일');
assert.equal(date('2026.07.19', 'month'), '2026.07');
assert.equal(date('2026.7.9', 'original'), '2026.7.9');
for (const value of ['2026.07', '여름 휴가', '2026-02-30', '1900-02-29'])
  assert.equal(date(value, 'korean'), value);
assert.equal(date('2000-02-29', 'hyphen'), '2000-02-29');
assert.equal(api.dateText({show:{date:false},date:'2026.07.19',dateFormat:'dots'}), '');
api.loadMetadataSettings({metadataShow:{iso:false},dateFormat:'hyphen'});
assert.deepEqual(api.metadataOptions(), {metadataShow:{aperture:true,shutter:true,iso:false,focal:true},dateFormat:'hyphen'});
api.loadMetadataSettings({});
assert.deepEqual(api.metadataOptions(), {metadataShow:{aperture:true,shutter:true,iso:true,focal:true},dateFormat:'original'});
console.log('메타데이터 검사 통과 · JPEG 부분/스캐너 EXIF 채택 · 수동값 보존 · 개별 표시 · 날짜 호환');
