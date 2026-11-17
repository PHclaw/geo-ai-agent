$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:8002/api"

$body = '{"phone":"13800000000","password":"123456"}'
$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body $body
$H = @{ Authorization = "Bearer $($login.token)" }
$me = Invoke-RestMethod -Uri "$base/me" -Headers $H
$bid = $me.brands[0].id

# 1) 批量生成 3 篇
$gen = Invoke-RestMethod -Uri "$base/contents/generate" -Method Post -Headers $H -ContentType "application/json" -Body (@{ brandId = $bid; genre = "攻略"; count = 3 } | ConvertTo-Json)
Write-Output "generated=$($gen.count) titles="
$gen.items | ForEach-Object { Write-Output ("  - " + $_.title + "  GEOS=" + $_.geos) }

# 2) 列表
$list = Invoke-RestMethod -Uri "$base/contents?brandId=$bid" -Headers $H
Write-Output "list=$(@($list).Count)"

# 3) 详情（含 dims）
$firstId = $gen.items[0].id
$detail = Invoke-RestMethod -Uri "$base/contents/$firstId" -Headers $H
Write-Output ("detail: geos=" + $detail.geos + " dims=" + $detail.dims.Count + " bodyLen=" + $detail.body.Length)
$detail.dims | ForEach-Object { Write-Output ("  " + $_.k + " " + $_.v + "/" + $_.max) }

# 4) 状态流转 draft -> review -> published
$r1 = Invoke-RestMethod -Uri "$base/contents/$firstId" -Method Patch -Headers $H -ContentType "application/json" -Body '{"status":"review"}'
$r2 = Invoke-RestMethod -Uri "$base/contents/$firstId" -Method Patch -Headers $H -ContentType "application/json" -Body '{"status":"published"}'
Write-Output "status: $($r1.status) -> $($r2.status)"

# 5) 指定 prompt 生成
$prompts = Invoke-RestMethod -Uri "$base/prompts?brandId=$bid" -Headers $H
$firstPromptId = @($prompts)[0].id
$one = Invoke-RestMethod -Uri "$base/contents/generate" -Method Post -Headers $H -ContentType "application/json" -Body (@{ brandId = $bid; genre = "问答"; promptId = $firstPromptId } | ConvertTo-Json -Depth 3)
Write-Output ("by-prompt: " + $one.items[0].title)

# 6) overview 的草稿数
$ov = Invoke-RestMethod -Uri "$base/overview?brandId=$bid" -Headers $H
Write-Output "overview todos[2]: $($ov.todos[2].title)"
