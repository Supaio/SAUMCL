$ErrorActionPreference = 'Stop'
$saumclTools = Join-Path $env:CI_PROJECT_DIR '.ci-tools'
New-Item -ItemType Directory -Path $saumclTools -Force | Out-Null
$saumclNodeChecksums = Invoke-RestMethod -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt'
$saumclNodeMatch = [regex]::Match($saumclNodeChecksums, '(?m)^([a-f0-9]{64})\s+(node-v24\.\d+\.\d+-win-x64\.zip)\r?$')
if (-not $saumclNodeMatch.Success) { throw 'Cannot identify the official Node.js Windows archive.' }
$saumclNodeName = $saumclNodeMatch.Groups[2].Value
$saumclNodeArchive = Join-Path $saumclTools $saumclNodeName
Invoke-WebRequest -Uri "https://nodejs.org/dist/latest-v24.x/$saumclNodeName" -OutFile $saumclNodeArchive
if ((Get-FileHash -LiteralPath $saumclNodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $saumclNodeMatch.Groups[1].Value) { throw 'Node.js archive checksum mismatch.' }
Expand-Archive -LiteralPath $saumclNodeArchive -DestinationPath $saumclTools -Force
$saumclNodeDirectory = Join-Path $saumclTools ([IO.Path]::GetFileNameWithoutExtension($saumclNodeName))
$env:PATH = "$saumclNodeDirectory;$env:PATH"
$env:CARGO_HOME = Join-Path $env:CI_PROJECT_DIR '.cache/cargo'
$env:RUSTUP_HOME = Join-Path $env:CI_PROJECT_DIR '.cache/rustup'
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
if (-not (Test-Path -LiteralPath (Join-Path $env:CARGO_HOME 'bin/rustup.exe'))) {
  $saumclRustup = Join-Path $saumclTools 'rustup-init.exe'
  Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $saumclRustup
  & $saumclRustup -y --profile minimal --default-toolchain stable
  if ($LASTEXITCODE -ne 0) { throw 'Rust installation failed.' }
}
rustup toolchain install stable --profile minimal --component rustfmt
if ($LASTEXITCODE -ne 0) { throw 'Rust toolchain setup failed.' }
rustup default stable
npm install --global pnpm@10.26.1 --prefix (Join-Path $saumclTools 'npm')
if ($LASTEXITCODE -ne 0) { throw 'pnpm installation failed.' }
$env:PATH = (Join-Path $saumclTools 'npm') + ';' + $env:PATH
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
pnpm run version check
if ($LASTEXITCODE -ne 0) { throw 'Version verification failed.' }
node node_modules/@tauri-apps/cli/tauri.js build --features devtools --no-bundle '--' --profile test-build --locked
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
cargo test --manifest-path src-tauri/Cargo.toml --locked --profile test-build --lib launcher_config::helpers::updater::tests
if ($LASTEXITCODE -ne 0) { throw 'Updater regressions failed.' }
cargo test --manifest-path src-tauri/Cargo.toml --locked --profile test-build --test campus_regressions
if ($LASTEXITCODE -ne 0) { throw 'School-server regressions failed.' }
New-Item -ItemType Directory -Path artifacts -Force | Out-Null
python scripts/release/bundle_portable_assets.py -p src-tauri/target/test-build -o SAUMCL-portable.exe SAUMCL.exe
if ($LASTEXITCODE -ne 0) { throw 'Portable resource bundling failed.' }
Copy-Item -LiteralPath src-tauri/target/test-build/SAUMCL-portable.exe -Destination artifacts/SAUMCL.exe
node scripts/release/gitlab-release.js upload artifacts/SAUMCL.exe windows
if ($LASTEXITCODE -ne 0) { throw 'Windows package upload failed.' }
