import assert from "node:assert/strict";
import { test } from "node:test";
import {
  officialRewardUrl,
  parseCommunityFeed,
  rewardDate,
  rewardState,
  safeCommunityUrl,
  validReward,
} from "../../src/utils/community.ts";

const offer = {
  id: "qa-cape",
  title: "QA cape",
  description: "An existing code and eligible game license are required.",
  kind: "cape",
  edition: "both",
  sourceUrl: "https://www.minecraft.net/en-us/article/qa-cape",
  claimUrl: "https://www.minecraft.net/en-us/redeem",
  startsAt: "2026-09-29T09:00:00-08:00",
  earnUntil: "2026-10-14T23:59:00-08:00",
  redeemUntil: "2026-10-31",
  requiresCode: true,
  noEndDate: false,
};

test("acquisition ends before code redemption, then expired rewards disappear", () => {
  assert.equal(
    rewardState(offer, Date.parse("2026-10-10T12:00:00Z")),
    "active"
  );
  assert.equal(
    rewardState(offer, Date.parse("2026-10-25T12:00:00Z")),
    "codeOnly"
  );
  assert.equal(
    rewardState(offer, rewardDate(offer.redeemUntil, true)),
    "codeOnly"
  );
  assert.equal(
    rewardState(offer, rewardDate(offer.redeemUntil, true) + 1),
    "expired"
  );
  assert.equal(
    rewardState(offer, Date.parse("2026-09-29T16:59:59Z")),
    "upcoming"
  );
});

test("offset timestamps compare as instants and date-only terms keep their original day", () => {
  assert.equal(
    rewardDate("2026-10-14T23:59:00-08:00"),
    Date.parse("2026-10-15T07:59:00Z")
  );
  const localEnd = new Date(rewardDate("2026-10-31", true));
  assert.equal(localEnd.getDate(), 31);
  assert.equal(localEnd.getHours(), 23);
  for (const date of [
    "2026-02-30",
    "2026-10-31T23:59:59",
    "2026-13-01",
    "2026-10-31garbage",
  ])
    assert.equal(rewardDate(date), null);
});

test("approval requires explicit eligibility, edition and an end or verified missing deadline", () => {
  assert.equal(validReward(offer, true), true);
  for (const patch of [
    { description: "" },
    { edition: "unknown" },
    { sourceUrl: "" },
    { claimUrl: "" },
    { earnUntil: null, redeemUntil: null },
    { redeemUntil: "2026-10-01" },
    { noEndDate: true },
  ])
    assert.equal(validReward({ ...offer, ...patch }, true), false);
  assert.equal(
    validReward(
      { ...offer, earnUntil: null, redeemUntil: null, noEndDate: true },
      true
    ),
    true
  );
  assert.equal(
    validReward(
      { ...offer, edition: "unknown", earnUntil: null, redeemUntil: null },
      false
    ),
    true
  );
});

test("only official article domains are accepted as evidence and executable URLs are rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///test",
    "https://user:password@example.invalid/",
    "data:text/html,test",
  ])
    assert.equal(safeCommunityUrl(url), false);
  for (const url of [
    "https://www.minecraft.net.example.invalid/en-us/article/fake",
    "http://www.minecraft.net/en-us/article/fake",
    "https://www.minecraft.net/en-us/redeem",
  ])
    assert.equal(officialRewardUrl(url), false);
  assert.equal(officialRewardUrl(offer.sourceUrl), true);
});

test("public feed validation blocks malformed entries, duplicate IDs and invalid group links", () => {
  const link = {
    id: "qa-group",
    kind: "qq",
    name: "QA group",
    description: "Test fixture",
    groupNumber: "123456789",
    url: "",
    enabled: true,
  };
  const feed = { schemaVersion: 1, rewards: [offer], links: [link] };
  assert.deepEqual(parseCommunityFeed(feed), feed);
  assert.equal(parseCommunityFeed({ ...feed, rewards: [offer, offer] }), null);
  assert.equal(
    parseCommunityFeed({ ...feed, rewards: [{ offer, status: "pending" }] }),
    null
  );
  assert.equal(
    parseCommunityFeed({
      ...feed,
      links: [{ ...link, url: "javascript:alert(1)" }],
    }),
    null
  );
  assert.equal(
    parseCommunityFeed({
      ...feed,
      links: [{ ...link, groupNumber: "invalid" }],
    }),
    null
  );
  assert.equal(
    parseCommunityFeed({
      ...feed,
      links: [{ ...link, section: "unsupported" }],
    }),
    null
  );
  assert.equal(parseCommunityFeed({ ...feed, rewards: [null] }), null);
  assert.deepEqual(
    parseCommunityFeed({ schemaVersion: 1, rewards: [], links: [] }),
    { schemaVersion: 1, rewards: [], links: [] }
  );
});
