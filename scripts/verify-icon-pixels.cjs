// Optional developer QA against the originals saved by icons:optimize.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function pixels(bytes) {
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    const parts=[];for(let at=8;at<bytes.length;){const n=bytes.readUInt32BE(at);if(bytes.toString('ascii',at+4,at+8)==='IDAT')parts.push(bytes.subarray(at+8,at+8+n));at+=n+12;}
    const data=zlib.inflateSync(Buffer.concat(parts)),stride=width*4,out=Buffer.alloc(stride*height);
    for(let y=0;y<height;y++)for(let x=0;x<stride;x++){
        const a=x>=4?out[y*stride+x-4]:0,b=y?out[(y-1)*stride+x]:0,c=y&&x>=4?out[(y-1)*stride+x-4]:0;
        const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
        const prediction=[0,a,b,(a+b)>>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][data[y*(stride+1)]];
        out[y*stride+x]=(data[y*(stride+1)+x+1]+prediction)&255;
    }
    return out;
}
const files=Object.keys(require('../src/icon-manifest.json').files);
for(const file of files) assert.deepEqual(pixels(fs.readFileSync(path.join(root,'public/icons',file))),pixels(fs.readFileSync(path.join(root,'qa/original-icons',file))),file);
console.log(`PASS: ${files.length} optimized PNGs preserve every RGBA pixel`);
