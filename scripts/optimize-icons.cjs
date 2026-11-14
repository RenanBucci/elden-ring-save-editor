// Developer-only lossless PNG optimization. No game installation is needed.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'public/icons');
const crcTable = Uint32Array.from({length:256}, (_, n) => {
    for(let i=0;i<8;i++) n=(n&1)?0xedb88320^(n>>>1):n>>>1;
    return n>>>0;
});
function chunk(type, data) {
    const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
    for(const byte of body) crc=crcTable[(crc^byte)&255]^(crc>>>8);
    const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
function paeth(a,b,c) {const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function optimize(input) {
    const chunks=[];let at=8;
    while(at<input.length){const len=input.readUInt32BE(at),type=input.toString('ascii',at+4,at+8);chunks.push({type,data:input.subarray(at+8,at+8+len)});at+=len+12;}
    const header=chunks[0].data;
    if(header[8]!==8||header[9]!==6||header[12]!==0)return input;
    const width=header.readUInt32BE(0),height=header.readUInt32BE(4),stride=width*4;
    const raw=zlib.inflateSync(Buffer.concat(chunks.filter(x=>x.type==='IDAT').map(x=>x.data)));
    const pixels=Buffer.alloc(height*stride),filtered=Buffer.alloc(raw.length);
    for(let y=0;y<height;y++){
        const filter=raw[y*(stride+1)];
        for(let x=0;x<stride;x++){
            const a=x>=4?pixels[y*stride+x-4]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=4?pixels[(y-1)*stride+x-4]:0;
            const predictor=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter];
            pixels[y*stride+x]=(raw[y*(stride+1)+1+x]+predictor)&255;
        }
        let bestScore=Infinity,best;
        for(let f=0;f<5;f++){
            const row=Buffer.alloc(stride+1);row[0]=f;let score=0;
            for(let x=0;x<stride;x++){
                const a=x>=4?pixels[y*stride+x-4]:0,b=y?pixels[(y-1)*stride+x]:0,c=y&&x>=4?pixels[(y-1)*stride+x-4]:0;
                const v=(pixels[y*stride+x]-[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][f])&255;
                row[x+1]=v;score+=Math.min(v,256-v);
            }
            if(score<bestScore){bestScore=score;best=row;}
        }
        best.copy(filtered,y*(stride+1));
    }
    const result=Buffer.concat([input.subarray(0,8),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(filtered,{level:9})),chunk('IEND',Buffer.alloc(0))]);
    return result.length<input.length?result:input;
}
let before=0,after=0;const files={};
const backup=path.join(root,'qa','original-icons');fs.mkdirSync(backup,{recursive:true});
for(const file of fs.readdirSync(dir).filter(f=>/^icon_\d+\.png$/.test(f)).sort()){
    const original=fs.readFileSync(path.join(dir,file));before+=original.length;
    if(!fs.existsSync(path.join(backup,file)))fs.writeFileSync(path.join(backup,file),original);
    const result=optimize(original);after+=result.length;fs.writeFileSync(path.join(dir,file),result);
    files[file]=crypto.createHash('sha256').update(result).digest('hex');
}
fs.writeFileSync(path.join(root,'src/icon-manifest.json'),JSON.stringify({version:1,files},null,2)+'\n');
console.log(JSON.stringify({count:Object.keys(files).length,before,after,saved:before-after}));
