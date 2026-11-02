const encoder=new TextEncoder();
const lifetime=30*86_400_000;
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
async function key(secret:string) {return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
export async function createOwnerSession(secret:string,now=Date.now()) {
  if (secret.length<32) throw new Error("A strong owner secret is required.");
  const expires=String(now+lifetime);
  return expires+"."+encode(new Uint8Array(await crypto.subtle.sign("HMAC",await key(secret),encoder.encode("boma-sync:"+expires))));
}
export async function validOwnerSession(token:string,secret:string,now=Date.now()) {
  if (secret.length<32 || token.length>180) return false;
  const [expires,signature]=token.split(".");
  if (!/^\d+$/.test(expires) || !signature || Number(expires)<=now || Number(expires)>now+lifetime+60_000) return false;
  try {
    const bytes=Uint8Array.from(atob(signature.replaceAll("-","+").replaceAll("_","/")),char=>char.charCodeAt(0));
    return await crypto.subtle.verify("HMAC",await key(secret),bytes,encoder.encode("boma-sync:"+expires));
  } catch {return false;}
}
export async function equalSecret(expected:string,actual:string) {
  const a=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(expected)));
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(actual)));
  let different=0;for(let i=0;i<a.length;i++) different|=a[i]^b[i];return different===0;
}
