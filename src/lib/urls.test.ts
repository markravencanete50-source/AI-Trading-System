import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFeedUrl } from "./server/urls.ts";

test("feed URLs must be public https", () => {
  assert.ok(safeFeedUrl("https://www.bworldonline.com/feed/"));
  for (const bad of ["http://example.com/feed", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x",
    "https://192.168.1.1/x", "https://169.254.169.254/latest", "https://user:pw@example.com/x", "https://intranet/x", "file:///etc/passwd", "nope"]) {
    assert.equal(safeFeedUrl(bad), null, bad);
  }
});
