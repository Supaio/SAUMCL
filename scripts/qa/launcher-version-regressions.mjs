import assert from "node:assert/strict";
import { test } from "node:test";
import {
  indevLauncherVersionLabel,
  isIndevLauncherVersion,
} from "../../src/utils/launcher-version.ts";

test("GitLab versions display the exact requested Indev GL order", () => {
  assert.equal(indevLauncherVersionLabel("19.3.0-indev.gl"), "Indev GL 19.3");
  assert.equal(indevLauncherVersionLabel("19.3.1-indev.gl"), "Indev GL 19.3.1");
  assert.equal(isIndevLauncherVersion("19.3.0-indev.gl"), true);
});

test("existing Indev version labels stay compatible", () => {
  assert.equal(indevLauncherVersionLabel("19.0.1-indev"), "Indev 19.0.1");
  assert.equal(indevLauncherVersionLabel("19.3.0-indev"), "Indev 19.3");
  assert.equal(indevLauncherVersionLabel("19.4.0-indev"), "Indev 19.4");
});

test("release and unrelated development labels are not rebranded", () => {
  for (const version of [
    "19.3.0",
    "test-build",
    "nightly",
    "19.3.0-beta",
    "invalid-indev.gl",
  ]) {
    assert.equal(indevLauncherVersionLabel(version), null);
    assert.equal(isIndevLauncherVersion(version), false);
  }
});
