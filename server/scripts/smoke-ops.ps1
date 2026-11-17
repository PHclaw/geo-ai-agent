$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:8002/api"

# 1) customer login
$c = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"phone":"13800000000","password":"123456"}'
$CH = @{ Authorization = "Bearer $($c.token)" }
$me = Invoke-RestMethod "$base/me" -Headers $CH
$bid = $me.brands[0].id
Write-Output "customer.role=$($me.user.role)"

# 2) create order
$media = Invoke-RestMethod "$base/media" -Headers $CH
$ids = @($media[0].id, $media[1].id)
$order = Invoke-RestMethod "$base/orders" -Method Post -Headers $CH -ContentType "application/json" -Body (@{ brandId = $bid; mediaIds = $ids; objective = "ops-test" } | ConvertTo-Json)
Write-Output "order=$($order.id.Substring(0,8)) total=$($order.total) status=$($order.status) count=$($order.count)"

# 3) permission check: customer must NOT reach ops api
try {
  Invoke-RestMethod "$base/ops/orders" -Headers $CH | Out-Null
  Write-Output "perm=FAIL(should be 403)"
}
catch {
  Write-Output "perm=403-ok"
}

# 4) ops login
$o = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" -Body '{"phone":"13900000000","password":"123456"}'
$OH = @{ Authorization = "Bearer $($o.token)" }
$ome = Invoke-RestMethod "$base/me" -Headers $OH
Write-Output "ops.role=$($ome.user.role)"

$stats = Invoke-RestMethod "$base/ops/stats" -Headers $OH
Write-Output "stats: pending=$($stats.pending) claimed=$($stats.claimed) publishedToday=$($stats.publishedToday) clients=$($stats.clients)"

$pending = Invoke-RestMethod "$base/ops/orders?status=pending" -Headers $OH
$target = @($pending | Where-Object { $_.id -eq $order.id })[0]
Write-Output "ops.pendingList=$(@($pending).Count) found=$(($null -ne $target)) brand=$($target.brand.name) ownerPhone=$($target.ownerPhone) placements=$(@($target.placements).Count)"

# 5) claim
$claim = Invoke-RestMethod "$base/ops/orders/$($order.id)/claim" -Method Post -Headers $OH -ContentType "application/json" -Body '{}'
Write-Output "claim: status=$($claim.status) assignee=$($claim.assignee)"

# double claim should fail
try {
  Invoke-RestMethod "$base/ops/orders/$($order.id)/claim" -Method Post -Headers $OH -ContentType "application/json" -Body '{}' | Out-Null
  Write-Output "claim-twice=FAIL"
}
catch {
  Write-Output "claim-twice=blocked-ok"
}

# 6) publish links one by one
$p1 = @($target.placements)[0]
$p2 = @($target.placements)[1]

$pub1 = Invoke-RestMethod "$base/ops/placements/$($p1.id)/publish" -Method Post -Headers $OH -ContentType "application/json" -Body (@{ url = "https://njhouse.example.com/a1"; publishedAt = "2026-10-27" } | ConvertTo-Json)
Write-Output "publish1: remaining=$($pub1.remaining) orderStatus=$($pub1.orderStatus)"

# invalid url should be rejected
try {
  Invoke-RestMethod "$base/ops/placements/$($p2.id)/publish" -Method Post -Headers $OH -ContentType "application/json" -Body '{"url":"not-a-url"}' | Out-Null
  Write-Output "bad-url=FAIL"
}
catch {
  Write-Output "bad-url=rejected-ok"
}

$pub2 = Invoke-RestMethod "$base/ops/placements/$($p2.id)/publish" -Method Post -Headers $OH -ContentType "application/json" -Body (@{ url = "https://yangtse.example.com/a2" } | ConvertTo-Json)
Write-Output "publish2: remaining=$($pub2.remaining) orderStatus=$($pub2.orderStatus)"

# 7) customer sees links
$co = Invoke-RestMethod "$base/orders?brandId=$bid" -Headers $CH
$mine = @($co | Where-Object { $_.id -eq $order.id })[0]
Write-Output "customer.view: status=$($mine.status) assignee=$($mine.assignee) mode=$($mine.deliveryMode)"
@($mine.placements) | ForEach-Object { Write-Output ("  item: " + $_.state + " | " + $_.url) }

# 8) stats after
$stats2 = Invoke-RestMethod "$base/ops/stats" -Headers $OH
Write-Output "stats.after: pending=$($stats2.pending) claimed=$($stats2.claimed) publishedToday=$($stats2.publishedToday)"
