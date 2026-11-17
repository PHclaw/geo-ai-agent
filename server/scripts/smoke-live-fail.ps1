$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
cd $root

$dbFile = Join-Path $root "data\test-fail.db"
foreach ($f in @($dbFile, "$dbFile-wal", "$dbFile-shm")) {
  if (Test-Path $f) { Remove-Item $f -Force }
}

# 仿真端点返回 401
$env:FAKE_FAIL = "auth"
$fake = Start-Process -FilePath "node" -ArgumentList "scripts/fake-openai.js" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1
Remove-Item Env:FAKE_FAIL -ErrorAction SilentlyContinue

$env:GEO_DB_PATH = $dbFile
$env:PORT = "4102"
$env:GEO_DEEPSEEK_KEY = "bad-key"
$env:GEO_DEEPSEEK_BASE = "http://127.0.0.1:4199/v1"
$env:GEO_DEEPSEEK_MODEL = "fake-model"
$srv = Start-Process -FilePath "node" -ArgumentList "index.js" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  $base = "http://127.0.0.1:4102/api"
  $login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"phone":"13800000000","password":"123456"}'
  $H = @{ Authorization = "Bearer $($login.token)" }
  $me = Invoke-RestMethod "$base/me" -Headers $H
  $bid = $me.brands[0].id

  $run = Invoke-RestMethod "$base/probes/run" -Method Post -Headers $H -ContentType "application/json" -Body (@{ brandId = $bid; platforms = @("deepseek"); sample = 1 } | ConvertTo-Json)
  $i = 0
  do {
    Start-Sleep -Seconds 1
    $st = Invoke-RestMethod "$base/probes/$($run.runId)" -Headers $H
    $i++
  } while ($st.run.status -eq "running" -and $i -lt 30)

  Write-Output "sources=$($st.summary.sources | ConvertTo-Json -Compress)"
  Write-Output "summary: avi=$($st.summary.avi) mentionRate=$($st.summary.mentionRate) accuracy=$($st.summary.accuracy)"
  $p = @($st.summary.byPlatform)[0]
  Write-Output "platform=$($p.platform) samples=$($p.samples) error=$($p.error)"

  $latest = Invoke-RestMethod "$base/probes/latest?brandId=$bid" -Headers $H
  if (@($latest.results).Count -gt 0) {
    $one = @($latest.results)[0]
    $detail = Invoke-RestMethod "$base/results/$($one.id)" -Headers $H
    Write-Output ("answer=" + $detail.result.answer.Substring(0, [Math]::Min(50, $detail.result.answer.Length)))
  }
  else {
    Write-Output "no-results(excluded as expected)"
  }
}
finally {
  if ($srv) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  if ($fake) { Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue }
  foreach ($k in @("GEO_DB_PATH","PORT","GEO_DEEPSEEK_KEY","GEO_DEEPSEEK_BASE","GEO_DEEPSEEK_MODEL","FAKE_FAIL")) {
    Remove-Item ("Env:" + $k) -ErrorAction SilentlyContinue
  }
}
