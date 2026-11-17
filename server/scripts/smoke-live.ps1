$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
cd $root

$dbFile = Join-Path $root "data\test-live.db"
foreach ($f in @($dbFile, "$dbFile-wal", "$dbFile-shm")) {
  if (Test-Path $f) { Remove-Item $f -Force }
}

# 1) 启动仿真 OpenAI 端点
$fake = Start-Process -FilePath "node" -ArgumentList "scripts/fake-openai.js" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 1

# 2) 启动后端（独立库 + deepseek 指向仿真端点）
$env:GEO_DB_PATH = $dbFile
$env:PORT = "4101"
$env:GEO_DEEPSEEK_KEY = "test-key"
$env:GEO_DEEPSEEK_BASE = "http://127.0.0.1:4199/v1"
$env:GEO_DEEPSEEK_MODEL = "fake-model"
$srv = Start-Process -FilePath "node" -ArgumentList "index.js" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
  $base = "http://127.0.0.1:4101/api"
  $h = Invoke-RestMethod "$base/health"
  $liveCount = @($h.providers | Where-Object { $_.live }).Count
  Write-Output "health: mode=$($h.mode) liveProviders=$liveCount/$(@($h.providers).Count)"

  $login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"phone":"13800000000","password":"123456"}'
  $H = @{ Authorization = "Bearer $($login.token)" }
  $me = Invoke-RestMethod "$base/me" -Headers $H
  $bid = $me.brands[0].id

  # 3) 连通性自检
  $t = Invoke-RestMethod "$base/providers/test" -Method Post -Headers $H -ContentType "application/json" -Body '{"key":"deepseek"}'
  Write-Output "provider-test(deepseek): ok=$($t.ok) ms=$($t.ms) model=$($t.model)"

  # 4) 只跑 deepseek 一个平台
  $run = Invoke-RestMethod "$base/probes/run" -Method Post -Headers $H -ContentType "application/json" -Body (@{ brandId = $bid; platforms = @("deepseek"); sample = 1 } | ConvertTo-Json)
  Write-Output "run: total=$($run.total) mode=$($run.mode)"

  $i = 0
  do {
    Start-Sleep -Seconds 1
    $st = Invoke-RestMethod "$base/probes/$($run.runId)" -Headers $H
    $i++
  } while ($st.run.status -eq "running" -and $i -lt 30)

  Write-Output "run.status=$($st.run.status) sources=$($st.summary.sources | ConvertTo-Json -Compress)"
  $p = @($st.summary.byPlatform)[0]
  Write-Output "platform=$($p.platform) avi=$($p.avi) mention=$($p.mentionRate) source=$($p.source) live=$($p.live) mock=$($p.mock) error=$($p.error)"
  Write-Output "summary: avi=$($st.summary.avi) mentionRate=$($st.summary.mentionRate) accuracy=$($st.summary.accuracy) sov=$($st.summary.sov)"

  # 5) 抽一条真实答案验证来自仿真端点
  $latest = Invoke-RestMethod "$base/probes/latest?brandId=$bid" -Headers $H
  $one = @($latest.results)[0]
  $detail = Invoke-RestMethod "$base/results/$($one.id)" -Headers $H
  $ans = $detail.result.answer
  Write-Output "answer.source=$($detail.result.platform) pos=$($detail.result.position) accuracy=$($detail.result.accuracy) len=$($ans.Length)"
  Write-Output ("answer.head=" + $ans.Substring(0, [Math]::Min(46, $ans.Length)))
  Write-Output ("containsBrand=" + $ans.Contains("和序装饰"))
}
finally {
  if ($srv) { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue }
  if ($fake) { Stop-Process -Id $fake.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:GEO_DB_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:PORT -ErrorAction SilentlyContinue
  Remove-Item Env:GEO_DEEPSEEK_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:GEO_DEEPSEEK_BASE -ErrorAction SilentlyContinue
  Remove-Item Env:GEO_DEEPSEEK_MODEL -ErrorAction SilentlyContinue
}
