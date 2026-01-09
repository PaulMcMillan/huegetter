import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSerialFromQRText,
  extractZFromQRText,
  normalizeSerial,
  serialFromZHex,
} from "../src/serial.js";

test("normalizeSerial validates 6 hex chars", () => {
  assert.equal(normalizeSerial("06e49f"), "06E49F");
  assert.equal(normalizeSerial("06E49F"), "06E49F");
  assert.equal(normalizeSerial("06E49F\n"), "06E49F");
  assert.equal(normalizeSerial("nothex"), null);
  assert.equal(normalizeSerial("123"), null);
});

test("extractZFromQRText pulls Z field", () => {
  const qr = "HUE:Z:1CCA7BF5138442DCBAB24E63DB590E0419C7 M:001788010BBEC356 D:K1F14 A:4717";
  assert.equal(
    extractZFromQRText(qr),
    "1CCA7BF5138442DCBAB24E63DB590E0419C7"
  );
});

test("serialFromZHex derives Hue serial", async () => {
  const zHex = "1CCA7BF5138442DCBAB24E63DB590E0419C7";
  const serial = await serialFromZHex(zHex);
  assert.equal(serial, "06E49F");
});

test("extractSerialFromQRText falls back to direct serial", () => {
  const qr = "Serial 06E49F";
  assert.equal(extractSerialFromQRText(qr), "06E49F");
});
