const {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { Writable } = require("node:stream");

const repository = path.resolve(__dirname, "../..");
const registryPath = path.join(
  repository,
  "src-tauri/assets/maintenance/trusted-keys.json"
);

function keyId(publicKey) {
  return createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
}

function createGrant(privateKey, name) {
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > 80) {
    throw new Error("维护人员名称须为 1–80 个字符。");
  }
  if (
    privateKey.asymmetricKeyType !== "rsa" ||
    privateKey.asymmetricKeyDetails.modulusLength < 2048
  ) {
    throw new Error("请使用本工具生成的 RSA 签名私钥。");
  }
  const publicKey = createPublicKey(privateKey);
  const header = { alg: "RS256", typ: "JWT", kid: keyId(publicKey) };
  const claims = {
    schema: 1,
    iss: "saumcl-maintainer",
    aud: "saumcl-maintenance",
    sub: randomUUID(),
    name: trimmed,
    role: "maintainer",
  };
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode(header)}.${encode(claims)}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(content),
    privateKey
  ).toString("base64url");
  return `SAUMCL-MAINT-1.${content}.${signature}`;
}

function assertOutsideRepository(target) {
  let current = path.resolve(target);
  const missing = [];
  while (!fs.existsSync(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) throw new Error("找不到目标磁盘或目录。");
    current = parent;
  }
  const resolved = path.resolve(fs.realpathSync(current), ...missing);
  const relative = path.relative(fs.realpathSync(repository), resolved);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    throw new Error("私钥和授权文件必须保存在 SAUMCL 专案之外。");
  }
  return resolved;
}

function addTrustedKey(publicKey) {
  const keys = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!Array.isArray(keys)) throw new Error("公钥清单格式错误。");
  const id = keyId(publicKey);
  if (!keys.some((key) => key.id === id)) {
    keys.push({
      id,
      publicKey: publicKey.export({ type: "spki", format: "pem" }),
    });
    fs.writeFileSync(registryPath, `${JSON.stringify(keys, null, 2)}\n`);
  }
}

function readPassphrase(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("请在交互式终端运行；口令不会通过参数或环境变量传入。");
  }
  process.stdout.write(prompt);
  const muted = new Writable({
    write(_chunk, _encoding, next) {
      next();
    },
  });
  const reader = readline.createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
    historySize: 0,
  });
  return new Promise((resolve, reject) => {
    reader.once("SIGINT", () => {
      reader.close();
      process.stdout.write("\n");
      reject(new Error("操作已取消。"));
    });
    reader.question("", (answer) => {
      reader.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const allowed =
    command === "init" ? ["--dir"] : ["--private-key", "--name", "--out"];
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!allowed.includes(option) || !args[index + 1] || options[option]) {
      throw new Error("参数错误，请参阅 docs/maintenance-mode.md。");
    }
    options[option] = args[index + 1];
  }
  if (command === "init" && options["--dir"]) {
    const directory = assertOutsideRepository(options["--dir"]);
    const privatePath = path.join(directory, "maintenance-private.pem");
    const publicPath = path.join(directory, "maintenance-public.pem");
    if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) {
      throw new Error("目标目录已存在签名文件，已停止以保留旧授权兼容性。");
    }
    const passphrase = await readPassphrase(
      "设置私钥保护口令（至少 12 字符，输入隐藏）："
    );
    const confirmation = await readPassphrase("再次输入口令：");
    if (passphrase.length < 12 || passphrase !== confirmation) {
      throw new Error("口令不足 12 字符或两次输入不同。");
    }
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 3072,
    });
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      privatePath,
      privateKey.export({
        type: "pkcs8",
        format: "pem",
        cipher: "aes-256-cbc",
        passphrase,
      }),
      { flag: "wx", mode: 0o600 }
    );
    fs.writeFileSync(
      publicPath,
      publicKey.export({ type: "spki", format: "pem" }),
      { flag: "wx", mode: 0o600 }
    );
    addTrustedKey(publicKey);
    console.log(
      "签名文件已保存到指定目录，公钥已加入专案。重新建置后可验证该签名的维护 Key。"
    );
    return;
  }
  if (
    command === "issue" &&
    options["--private-key"] &&
    options["--name"] &&
    options["--out"]
  ) {
    const privatePath = assertOutsideRepository(options["--private-key"]);
    const outputPath = assertOutsideRepository(options["--out"]);
    if (fs.existsSync(outputPath))
      throw new Error("授权文件已存在，已停止以避免覆盖。");
    const passphrase = await readPassphrase("输入私钥保护口令（输入隐藏）：");
    let privateKey;
    try {
      privateKey = createPrivateKey({
        key: fs.readFileSync(privatePath),
        passphrase,
      });
    } catch {
      throw new Error("无法打开私钥，请检查路径与保护口令。");
    }
    const grant = createGrant(privateKey, options["--name"]);
    fs.writeFileSync(outputPath, grant, { flag: "wx", mode: 0o600 });
    console.log(
      "长期维护授权文件已生成，请只把该 .saumclkey 文件发给对应维护人员。"
    );
    return;
  }
  console.log(
    "初始化：node scripts/maintenance/keys.js init --dir <专案外的私钥目录>"
  );
  console.log(
    "签发：node scripts/maintenance/keys.js issue --private-key <私钥文件> --name <维护人员名称> --out <授权文件.saumclkey>"
  );
}

module.exports = { assertOutsideRepository, createGrant, keyId };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
