import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/telegram-policy.ts", import.meta.url).pathname; const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { telegramDecision } = mod.exports;
const quiet = { mode: "ENTRIES_ONLY", enteredCoins: [] }, inSol = { mode: "ENTRIES_ONLY", enteredCoins: ["SOL"] }, loud = { mode: "EVERYTHING", enteredCoins: [] };

test("Quiet mode: only confirmed entries are pushed", () => {
  for (const key of ["signal:BTCUSDT:LONG:1", "whale:signal:ZEC:SHORT:83106", "ws2:ready:BTC:SHORT:20785"]) assert.equal(telegramDecision(key, quiet).send, true, key);
  // The messages that were flooding Telegram are all stopped.
  for (const key of ["whale:event:0xceec…a7ce:BTC:OPEN:1795887906078", "whale:exit:BTC:LONG:166285", "whale:watch:abc", "whale:checkin:CRV:SHORT:83101", "monitor:digest:499000", "forming:XRPUSDT:LONG:1:2:3", "something:else"]) {
    const d = telegramDecision(key, quiet); assert.equal(d.send, false, key); assert.ok(d.reason.length > 0);
  }
});

test("Quiet mode still tells you about trades you entered and confirms your own taps", () => {
  for (const key of ["exit:BTCUSDT:plan:TP1", "exit:whale:RUNE:1:CLOSE", "advice:whale:CRV:1:REDUCE / EXIT", "whale:warn:SOL:LONG:e1", "whale:entered:SOL:1", "whale:exited:SOL:1", "monitor:whale-analysis:SOL:1", "monitor:BTCUSDT:plan:STOP HIT"]) assert.equal(telegramDecision(key, quiet).send, true, key);
  assert.equal(telegramDecision("whale:exit:SOL:LONG:1", inSol).send, true, "whales leaving a coin you are in is about your trade");
  assert.equal(telegramDecision("whale:exit:BTC:LONG:1", inSol).send, false);
  assert.equal(telegramDecision("whale:event:x:SOL:CLOSE:1", inSol).send, false, "single whale moves stay off; the warning covers your trade");
});

test("Switching quiet mode off sends everything again", () => {
  for (const key of ["whale:event:x:BTC:OPEN:1", "whale:exit:BTC:LONG:1", "whale:checkin:CRV:SHORT:1", "monitor:digest:1"]) assert.equal(telegramDecision(key, loud).send, true, key);
});
