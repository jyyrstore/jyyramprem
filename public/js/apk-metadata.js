/* Browser-side APK metadata reader. It never supplies trusted release metadata; server verifies again. */
(() => {
  const ANDROID_NS = "http://schemas.android.com/apk/res/android";
  const TYPE_STRING = 0x03, TYPE_INT_DEC = 0x10, TYPE_INT_HEX = 0x11;
  const td = new TextDecoder("utf-8");
  const tdu = new TextDecoder("utf-16le");
  const u16 = (v, o) => v.getUint16(o, true), u32 = (v, o) => v.getUint32(o, true);
  const bytes = (b) => new Uint8Array(b);
  const text = (b) => td.decode(b);

  function stringPool(v, base) {
    const header = u16(v, base + 2), count = u32(v, base + 8), flags = u32(v, base + 16), start = u32(v, base + 20);
    const offsets = base + header, data = base + start, out = [];
    for (let i=0;i<count;i++) {
      let p = data + u32(v, offsets + i*4);
      if (flags & 0x100) {
        let n=v.getUint8(p++); if(n&0x80){n=((n&0x7f)<<8)|v.getUint8(p++);} let chars=v.getUint8(p++); if(chars&0x80){chars=((chars&0x7f)<<8)|v.getUint8(p++);} out.push(text(new Uint8Array(v.buffer,p+v.byteOffset,chars))); 
      } else { const n=u16(v,p); p+=2; out.push(tdu.decode(new Uint8Array(v.buffer,p+v.byteOffset,n*2))); }
    }
    return out;
  }
  function parseManifest(ab) {
    const v=new DataView(ab); if(v.byteLength<8||u16(v,0)!==3) throw new Error("AndroidManifest.xml bukan binary XML Android yang valid.");
    const total=u32(v,4); let strings=[], result={};
    for(let p=8;p+8<=total;) { const type=u16(v,p), h=u16(v,p+2), size=u32(v,p+4); if(h<8||size<h||p+size>total) throw new Error("Chunk AndroidManifest.xml tidak valid.");
      if(type===1) strings=stringPool(v,p);
      else if(type===0x102) { const ns=u32(v,p+16), name=u32(v,p+20), attrStart=u16(v,p+24), attrSize=u16(v,p+26), count=u16(v,p+28), tag=strings[name]||"";
        for(let i=0;i<count;i++){const a=p+16+attrStart+i*attrSize, ans=u32(v,a), an=u32(v,a+4), raw=u32(v,a+8), vt=u16(v,a+15), vd=u32(v,a+16), key=strings[an]||""; let val=raw!==0xffffffff?(strings[raw]??null):(vt===TYPE_STRING?(strings[vd]??null):vd>>>0); const android=ans<strings.length&&strings[ans]===ANDROID_NS;
          if(tag==="manifest"&&key==="package")result.packageName=String(val||"");
          if(tag==="manifest"&&android&&key==="versionName")result.versionName=String(val??"");
          if(tag==="manifest"&&android&&key==="versionCode")result.versionCode=Number(val);
          if(tag==="uses-sdk"&&android&&key==="minSdkVersion")result.minSdk=Number(val);
          if(tag==="uses-sdk"&&android&&key==="targetSdkVersion")result.targetSdk=Number(val);
        }
      } p+=size;
    }
    if(!result.packageName||!result.versionName||!Number.isInteger(result.versionCode)||!Number.isInteger(result.minSdk)||!Number.isInteger(result.targetSdk)) throw new Error("Metadata AndroidManifest.xml tidak lengkap.");
    return result;
  }
  async function inflateRaw(data, expected) {
    if(typeof DecompressionStream!=="function") throw new Error("Browser tidak mendukung pembacaan compressed APK manifest. Coba Chrome/Edge terbaru.");
    const ds=new DecompressionStream("deflate-raw"); const out=await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
    if(expected&&out.byteLength!==expected) throw new Error("AndroidManifest.xml hasil dekompresi tidak cocok."); return out;
  }
  async function readManifest(file) {
    const ab=await file.arrayBuffer(), v=new DataView(ab), len=v.byteLength; let e=-1;
    for(let p=len-22;p>=Math.max(0,len-0x10000-22);p--) if(u32(v,p)===0x06054b50){e=p;break;}
    if(e<0) throw new Error("APK ZIP central directory tidak ditemukan."); const count=u16(v,e+10), dir=u32(v,e+16); let p=dir;
    for(let i=0;i<count;i++){ if(u32(v,p)!==0x02014b50) throw new Error("APK ZIP entry tidak valid."); const comp=u16(v,p+10), cs=u32(v,p+20), us=u32(v,p+24), nl=u16(v,p+28), xl=u16(v,p+30), cl=u16(v,p+32), lo=u32(v,p+42); const name=text(new Uint8Array(ab,p+46,nl));
      if(name==="AndroidManifest.xml"){const lnl=u16(v,lo+26), lxl=u16(v,lo+28), start=lo+30+lnl+lxl, raw=ab.slice(start,start+cs); const manifest=comp===0?raw:comp===8?await inflateRaw(raw,us):null; if(!manifest) throw new Error(`Metode ZIP ${comp} tidak didukung.`); return parseManifest(manifest);}
      p+=46+nl+xl+cl;
    } throw new Error("AndroidManifest.xml tidak ditemukan di APK.");
  }
  window.JYYRReadApkMetadata = readManifest;
})();
