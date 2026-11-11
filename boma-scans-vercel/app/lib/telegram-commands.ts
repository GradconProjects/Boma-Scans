export const BOT_FRAMES:Record<string,string>={"5m":"5","15m":"15","30m":"30","1h":"60","2h":"120","4h":"240","1d":"D","1w":"W"};
export function parseBotCommand(text:string) {
 const [raw,...args]=text.trim().split(/\s+/);
 const command=raw.split("@")[0].toLowerCase();
 if(!command.startsWith("/"))return {command:"/analyse",args:[raw.toUpperCase(),...args]};
 return {command:command==="/analyze"?"/analyse":command,args};
}
export function botSetting(command:string,value:string):Record<string,unknown>|null {
 if (!value.trim()) return null;
 if(command==="/timeframe"&&BOT_FRAMES[value.toLowerCase()])return {interval:BOT_FRAMES[value.toLowerCase()]};
 if(command==="/style"&&["SCALP","DAY","SWING","POSITION"].includes(value.toUpperCase()))return {style:value.toUpperCase()};
 if(command==="/targets"&&["TA","LADDER"].includes(value.toUpperCase()))return {targetStyle:value.toUpperCase()};
 if(command==="/risk"&&["STRICT","BALANCED","FLEXIBLE"].includes(value.toUpperCase()))return {flexibility:value.toUpperCase()};
 if(command==="/direction"&&["BOTH","LONG","SHORT"].includes(value.toUpperCase()))return {directionFilter:value.toUpperCase()};
 if(command==="/filter"&&["ALL","LOW","MEDIUM","HIGH"].includes(value.toUpperCase()))return {riskFilter:value.toUpperCase()};
 if(command==="/autoscan"&&["on","off"].includes(value.toLowerCase()))return {autoScan:value.toLowerCase()==="on"};
 const number=Number(value);
 if(!Number.isFinite(number))return null;
 if(command==="/equity"&&number>0&&number<=1e9)return {equity:number};
 if(command==="/fee"&&number>=0&&number<=0.3)return {fee:number};
 if(command==="/slippage"&&number>=0&&number<=1)return {slippage:number};
 if(command==="/interval"&&[15,30,60,180].includes(number))return {autoScanMinutes:number};
 return null;
}
