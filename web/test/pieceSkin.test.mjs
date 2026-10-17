import assert from "node:assert/strict";
import test from "node:test";
import { BLACK_FALLBACK_SKIN, skinFromMetadataURI } from "../src/pieceSkin.js";

test("reads a generated chess-piece palette from a data URI", () => {
  const metadata = { attributes: [{ trait_type: "Style", value: "Aurora" }, { trait_type: "Palette", value: "Violet" }] };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
  assert.deepEqual(skinFromMetadataURI(uri, BLACK_FALLBACK_SKIN), {
    style: "Aurora",
    palette: "Violet",
    primary: "#8b5cf6",
    secondary: "#e9d5ff"
  });
});

test("uses the role skin when metadata has no recognized palette", () => {
  assert.equal(skinFromMetadataURI("ipfs://unknown", BLACK_FALLBACK_SKIN), BLACK_FALLBACK_SKIN);
});
