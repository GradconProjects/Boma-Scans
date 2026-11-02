export async function telegramCall(token:string, method:string, body:unknown) {
  let response;
  try {response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});}
  catch {throw new Error("Telegram delivery could not be confirmed. Check the notification status before retrying.");}
  const payload=await response.json() as {ok:boolean;result?:{username?:string;message_id?:number};error_code?:number};
  if (!response.ok || !payload.ok) throw new Error("Telegram rejected the request ("+(payload.error_code??response.status)+"). Check the bot token, chat ID and that you pressed Start in the bot chat.");
  return payload.result;
}
export function telegramChunks(text:string) {
  const chunks:string[]=[];let current="";
  for (const line of text.split("\n")) {
    if ((current+"\n"+line).length>3800 && current) {chunks.push(current);current="";}
    for(let offset=0;offset<line.length;offset+=3500) {
      const part=line.slice(offset,offset+3500);
      if ((current+"\n"+part).length>3800 && current) {chunks.push(current);current="";}
      current+=(current?"\n":"")+part;
    }
  }
  if(current)chunks.push(current);return chunks;
}
