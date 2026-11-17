$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:8002/api"

function Show($label, $obj) {
  Write-Output "== $label =="
  $obj | ConvertTo-Json -Depth 5 -Compress
  Write-Output ""
}

# 1) health
$h = Invoke-RestMethod -Uri "$base/health" -Method Get
Show "health" $h

# 2) login
$body = @{ phone = "13800000000"; password = "123456" } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
$token = $login.token
$H = @{ Authorization = "Bearer $token" }
Show "login" @{ ok = [bool]$token; user = $login.user }

# 3) me
$me = Invoke-RestMethod -Uri "$base/me" -Headers $H
Show "me" @{ tenant = $me.tenant; brands = $me.brands.Count; mode = $me.mode }

$brandId = $me.brands[0].id
Write-Output "brandId=$brandId"

# 4) facts
$facts = Invoke-RestMethod -Uri "$base/facts?brandId=$brandId" -Headers $H
$conflicts = @($facts | Where-Object { $_.status -eq "conflict" })
Write-Output "facts=$($facts.Count) conflicts=$($conflicts.Count)"

# 5) overview（探测前）
$ov = Invoke-RestMethod -Uri "$base/overview?brandId=$brandId" -Headers $H
Show "overview(before)" @{ kpi = $ov.kpi; lastRun = $ov.lastRun; todos = $ov.todos.Count }

# 6) 跑一次探测
$runBody = @{ brandId = $brandId; sample = 1 } | ConvertTo-Json
$run = Invoke-RestMethod -Uri "$base/probes/run" -Method Post -Headers $H -ContentType "application/json" -Body $runBody
Write-Output "runId=$($run.runId) total=$($run.total) mode=$($run.mode)"

# 7) 轮询
$i = 0
do {
  Start-Sleep -Seconds 2
  $st = Invoke-RestMethod -Uri "$base/probes/$($run.runId)" -Headers $H
  $i++
  Write-Output "poll#$i status=$($st.run.status) done=$($st.run.done)/$($st.run.total)"
} while ($st.run.status -eq "running" -and $i -lt 40)

Show "run summary" $st.summary

# 8) overview（探测后）
$ov2 = Invoke-RestMethod -Uri "$base/overview?brandId=$brandId" -Headers $H
Show "overview(after)" @{ kpi = $ov2.kpi; byPlatform = $ov2.byPlatform }

# 9) 生成内容
$cBody = @{ brandId = $brandId; genre = "攻略" } | ConvertTo-Json
$c = Invoke-RestMethod -Uri "$base/contents/generate" -Method Post -Headers $H -ContentType "application/json" -Body $cBody
Show "content" @{ title = $c.title; geos = $c.geos; dims = $c.dims }
