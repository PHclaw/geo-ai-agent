$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:8002/api"

$login = Invoke-RestMethod -Uri "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"phone":"13800000000","password":"123456"}'
$H = @{ Authorization = "Bearer $($login.token)" }
$me = Invoke-RestMethod -Uri "$base/me" -Headers $H
$bid = $me.brands[0].id

# 1) 媒体库
$media = Invoke-RestMethod -Uri "$base/media" -Headers $H
Write-Output "media=$(@($media).Count) top=$($media[0].name)/AIW $($media[0].aiw)/$($media[0].price)"

# 2) 历史台账
$before = Invoke-RestMethod -Uri "$base/placements?brandId=$bid" -Headers $H
Write-Output "placements(before)=$(@($before).Count)"

# 3) 下单（选 3 家）
$ids = @($media[0].id, $media[1].id, $media[3].id)
$order = Invoke-RestMethod -Uri "$base/orders" -Method Post -Headers $H -ContentType "application/json" -Body (@{ brandId = $bid; mediaIds = $ids; objective = "local" } | ConvertTo-Json -Depth 4)
Write-Output "order=$($order.id.Substring(0,8)) count=$($order.count) total=$($order.total) avgAiw=$($order.avgAiw) status=$($order.status)"

# 4) 订单列表
$orders = Invoke-RestMethod -Uri "$base/orders?brandId=$bid" -Headers $H
Write-Output "orders=$(@($orders).Count) first.media=$((@($orders)[0].media | ForEach-Object { $_.name }) -join ', ')"

# 5) 台账应增加 3 条待发布
$after = Invoke-RestMethod -Uri "$base/placements?brandId=$bid" -Headers $H
$pending = @($after | Where-Object { $_.state -eq "pending" -or $_.state -like "*published*" -eq $false -and $_.publishedAt -eq "" })
Write-Output "placements(after)=$(@($after).Count) pending=$($pending.Count)"

# 6) 标记完成
$pub = Invoke-RestMethod -Uri "$base/orders/$($order.id)" -Method Patch -Headers $H -ContentType "application/json" -Body '{"status":"published"}'
$final = Invoke-RestMethod -Uri "$base/placements?brandId=$bid" -Headers $H
$done = @($final | Where-Object { $_.state -ne "pending" -and $_.publishedAt -ne "" })
Write-Output "order.status=$($pub.status) placements=$(@($final).Count) done=$($done.Count)"
