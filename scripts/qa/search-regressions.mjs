import assert from "node:assert/strict";
import { test } from "node:test";
import { createTextSearch } from "../../src/utils/search.ts";

const jei = {
  modId: "jei",
  name: "Just Enough Items",
  translatedName: "物品管理器",
  fileName: "jei-26.2-fabric-30.39.0.232.jar",
  relativePath: "jei-26.2-fabric-30.39.0.232.jar",
};
const sodium = {
  modId: "sodium",
  name: "Sodium",
  translatedName: "钠",
  fileName: "sodium-fabric.jar",
};
const jade = { modId: "jade", name: "Jade", translatedName: "玉" };
const searchFields = (mod) => [
  mod.modId,
  mod.name,
  mod.translatedName,
  mod.fileName,
  mod.relativePath,
];
const mods = [sodium, jei, jade];
const search = createTextSearch(mods, searchFields);

test("JEI matches Chinese, partial pinyin, full pinyin and initials", () => {
  for (const query of [
    "物品",
    "管理器",
    "wu",
    "wupin",
    "wupinguanliqi",
    "wpglq",
  ]) {
    assert.deepEqual(search(query), [jei], query);
  }
});

test("English names, IDs and filenames remain searchable", () => {
  for (const query of ["JEI", "Just Enough", "enough items", "30.39.0.232"]) {
    assert.deepEqual(search(query), [jei], query);
  }
  assert.deepEqual(search("SODIUM"), [sodium]);
  assert.deepEqual(search("钠"), [sodium]);
  assert.deepEqual(search("na"), [sodium]);
});

test("English spelling errors can still find the intended mod", () => {
  assert.deepEqual(search("enouhg"), [jei]);
  assert.deepEqual(search("sodum"), [sodium]);
});

test("Chinese filenames work even when translated metadata is missing", () => {
  const fileOnly = {
    modId: "jei",
    name: "Just Enough Items",
    fileName: "物品管理器jei-26.2-fabric-30.39.0.232.jar",
    relativePath: "1.7.10/物品管理器jei.jar.disabled",
  };
  const fileSearch = createTextSearch([fileOnly, sodium], searchFields);
  assert.deepEqual(fileSearch("wu"), [fileOnly]);
  assert.deepEqual(fileSearch("wpglq"), [fileOnly]);
  assert.deepEqual(fileSearch("1.7.10"), [fileOnly]);
});

test("simplified and traditional Chinese names match the same pronunciation", () => {
  const optimization = { name: "Optimization", translatedName: "优化" };
  const find = createTextSearch([optimization], searchFields);
  for (const query of ["優化", "优化", "youhua", "yh"]) {
    assert.deepEqual(find(query), [optimization]);
  }
});

test("pinyin handles case, fullwidth input and toned umlauts", () => {
  assert.deepEqual(search("ＷＵ"), [jei]);
  assert.deepEqual(search("WǓ"), [jei]);
  const emerald = { name: "绿宝石" };
  const find = createTextSearch([emerald], searchFields);
  for (const query of ["lv", "lü", "lǜ"]) {
    assert.deepEqual(find(query), [emerald]);
  }
});

test("blank input, no matches and multiple keywords preserve list behavior", () => {
  assert.equal(search(" \t\n"), mods);
  assert.deepEqual(search("no-such-mod-xyzzy"), []);
  const matches = search("wu sodium");
  assert.deepEqual(matches, [sodium, jei]);
  assert.equal(matches[1], jei, "mod actions must receive the original object");
});

test("instance search covers names, versions, loaders and descriptions", () => {
  const fabric = { name: "26.3-Fabric", version: "26.3", loader: "Fabric" };
  const gtnh = {
    name: "GTNH 2.8.4",
    version: "1.7.10",
    description: "格雷科技",
  };
  const find = createTextSearch([fabric, gtnh], (instance) => [
    instance.name,
    instance.version,
    instance.loader,
    instance.description,
  ]);
  assert.deepEqual(find("fabric"), [fabric]);
  assert.deepEqual(find("1.7.10"), [gtnh]);
  assert.deepEqual(find("gelei"), [gtnh]);
  assert.deepEqual(find("格雷"), [gtnh]);
});

test("same-name instances keep their identity across game directories", () => {
  const instances = [
    { name: "Survival", id: "C:/Games:Survival" },
    { name: "Survival", id: "D:/Games:Survival" },
  ];
  const find = createTextSearch(instances, (instance) => [
    instance.name,
    instance.id,
  ]);
  assert.deepEqual(find("survival"), instances);
  assert.equal(find("D:/Games:Survival").at(-1), instances[1]);
});
