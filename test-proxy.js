import fetch from 'node-fetch';
import { Buffer } from 'buffer';

const streamUrl = 'https://dc772.4shared.com/img/aCWMhydzku/62956436/dlink__2Fdownload_2FaCWMhydzku_2FA_5FRezadeira_5F-_5FProjota.mp3_3Fsbsr_3D9ea15e12ee00910af24dd5c68259d92eb82_26bip_3DMTg3LjEyMi42MS4xMTQ_26lgfp_3D52_26bip_3DMTg3LjEyMi42MS4xMTQ/preview.mp3';

async function test() {
  const start = 0;
  const targetEnd = 2000000;
  const proxyRes = await fetch(streamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Range': `bytes=${start}-${targetEnd}`
    }
  });
  console.log('Status:', proxyRes.status);
  console.log('Content-Range:', proxyRes.headers.get('content-range'));
  console.log('Content-Length:', proxyRes.headers.get('content-length'));
  
  const buffer = await proxyRes.arrayBuffer();
  console.log('ArrayBuffer byte length:', buffer.byteLength);
}
test().catch(console.error);
