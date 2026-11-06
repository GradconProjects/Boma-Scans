import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import Module, { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const file = new URL("../app/lib/owner-session.ts", import.meta.url).pathname;
const mod = new Module(file); mod.require = require;
mod._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { createOwnerSession, validOwnerSession, hashPassword, verifyPassword, equalSecret, randomMaterial } = mod.exports;

test("Short PINs hash and verify; wrong PIN and wrong salt fail", async () => {
  const record = await hashPassword("2580");
  assert.ok(record.salt && record.hash && record.iterations >= 100_000);
  assert.equal(await verifyPassword("2580", record), true);
  assert.equal(await verifyPassword("2581", record), false);
  const other = await hashPassword("2580");
  assert.notEqual(other.hash, record.hash, "fresh salt each time");
  assert.equal(await verifyPassword("2580", { ...record, salt: other.salt }), false);
});
test("Session cookies are bound to the signing material, not the PIN", async () => {
  const material = "2580:" + randomMaterial();
  const token = await createOwnerSession(material);
  assert.equal(await validOwnerSession(token, material), true);
  assert.equal(await validOwnerSession(token, "2580:"), false);
  assert.equal(await validOwnerSession(token, material, Date.now() + 91 * 86_400_000), false, "expired");
  const [expires, signature] = token.split(".");
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(await validOwnerSession(expires + "." + flipped, material), false, "tampered");
  assert.equal(await equalSecret("abc", "abc"), true);
  assert.equal(await equalSecret("abc", "abd"), false);
});
