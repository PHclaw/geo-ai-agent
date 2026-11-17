$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:8002/api"

function Login($phone, $pwd) {
  $b = @{ phone = $phone; password = $pwd } | ConvertTo-Json
  return (Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" -Body $b).token
}

# 1) owner
$ownerT = Login "13800000000" "123456"
$OH = @{ Authorization = "Bearer $ownerT" }
$me = Invoke-RestMethod "$base/me" -Headers $OH
$bid = $me.brands[0].id
Write-Output "owner: role=$($me.user.role) write=$($me.permissions.write) manage=$($me.permissions.manage)"

# 2) invite editor + viewer (idempotent)
$editorPhone = "13911110001"; $viewerPhone = "13911110002"; $pwd = "pass1234"
try {
  $e = Invoke-RestMethod "$base/members" -Method Post -Headers $OH -ContentType "application/json" -Body (@{ phone = $editorPhone; name = "Editor A"; role = "editor"; password = $pwd } | ConvertTo-Json)
  Write-Output "invite.editor=created role=$($e.role) pwd=$($e.initialPassword)"
}
catch { Write-Output "invite.editor=already-exists" }
try {
  $v = Invoke-RestMethod "$base/members" -Method Post -Headers $OH -ContentType "application/json" -Body (@{ phone = $viewerPhone; name = "Viewer B"; role = "viewer"; password = $pwd } | ConvertTo-Json)
  Write-Output "invite.viewer=created role=$($v.role)"
}
catch { Write-Output "invite.viewer=already-exists" }

$ms = Invoke-RestMethod "$base/members" -Headers $OH
Write-Output "members.total=$(@($ms).Count) roles=$(($ms | ForEach-Object { $_.role }) -join ',')"

# 3) editor permissions
$et = Login $editorPhone $pwd
$EH = @{ Authorization = "Bearer $et" }
$eme = Invoke-RestMethod "$base/me" -Headers $EH
Write-Output "editor: role=$($eme.user.role) write=$($eme.permissions.write) manage=$($eme.permissions.manage)"

$stamp = (Get-Date -Format "HHmmss")
try {
  Invoke-RestMethod "$base/facts" -Method Post -Headers $EH -ContentType "application/json" -Body (@{ brandId = $bid; subject = "Brand"; attr = "team-size-$stamp"; value = "42" } | ConvertTo-Json) | Out-Null
  Write-Output "editor.fact=ok"
}
catch { Write-Output "editor.fact=FAIL $($_.Exception.Message)" }

try {
  Invoke-RestMethod "$base/facts" -Method Post -Headers $EH -ContentType "application/json" -Body (@{ brandId = $bid; subject = "Brand"; attr = "price-range"; value = "999" } | ConvertTo-Json) | Out-Null
  Write-Output "editor.priceFact=FAIL(should 403)"
}
catch { Write-Output "editor.priceFact=blocked-ok" }

try {
  Invoke-RestMethod "$base/members" -Method Post -Headers $EH -ContentType "application/json" -Body (@{ phone = "13911110009"; role = "viewer"; password = $pwd } | ConvertTo-Json) | Out-Null
  Write-Output "editor.invite=FAIL(should 403)"
}
catch { Write-Output "editor.invite=blocked-ok" }

try {
  Invoke-RestMethod "$base/audit-logs" -Headers $EH | Out-Null
  Write-Output "editor.audit=FAIL(should 403)"
}
catch { Write-Output "editor.audit=blocked-ok" }

try {
  $c = Invoke-RestMethod "$base/contents/generate" -Method Post -Headers $EH -ContentType "application/json" -Body (@{ brandId = $bid; count = 1 } | ConvertTo-Json)
  Write-Output "editor.content=ok geos=$($c.items[0].geos)"
}
catch { Write-Output "editor.content=FAIL" }

# 4) viewer permissions
$vt = Login $viewerPhone $pwd
$VH = @{ Authorization = "Bearer $vt" }
$vme = Invoke-RestMethod "$base/me" -Headers $VH
Write-Output "viewer: role=$($vme.user.role) write=$($vme.permissions.write)"

try {
  Invoke-RestMethod "$base/probes/run" -Method Post -Headers $VH -ContentType "application/json" -Body (@{ brandId = $bid } | ConvertTo-Json) | Out-Null
  Write-Output "viewer.probe=FAIL(should 403)"
}
catch { Write-Output "viewer.probe=blocked-ok" }

try {
  $ov = Invoke-RestMethod "$base/overview?brandId=$bid" -Headers $VH
  Write-Output "viewer.read=ok avi=$($ov.kpi.avi)"
}
catch { Write-Output "viewer.read=FAIL" }

# 5) cross-tenant isolation
$newPhone = "13700001234"
try {
  Invoke-RestMethod "$base/auth/register" -Method Post -ContentType "application/json" -Body (@{ phone = $newPhone; password = "pass1234"; name = "Tenant B" } | ConvertTo-Json) | Out-Null
}
catch { }
$bt = Login $newPhone "pass1234"
$BH = @{ Authorization = "Bearer $bt" }
try {
  Invoke-RestMethod "$base/facts?brandId=$bid" -Headers $BH | Out-Null
  Write-Output "crossTenant.facts=FAIL(leak!)"
}
catch { Write-Output "crossTenant.facts=blocked-ok" }
try {
  Invoke-RestMethod "$base/contents/generate" -Method Post -Headers $BH -ContentType "application/json" -Body (@{ brandId = $bid; count = 1 } | ConvertTo-Json) | Out-Null
  Write-Output "crossTenant.write=FAIL(leak!)"
}
catch { Write-Output "crossTenant.write=blocked-ok" }

# 6) audit
$logs = Invoke-RestMethod "$base/audit-logs" -Headers $OH
Write-Output "audit.logs=$(@($logs).Count) latest=$(@($logs)[0].action) by=$(@($logs)[0].userName)"

# 7) remove viewer then login must fail
$vm = @($ms | Where-Object { $_.role -eq "viewer" -and -not $_.isSelf })[0]
if ($vm) {
  try {
    Invoke-RestMethod "$base/members/$($vm.id)" -Method Delete -Headers $OH | Out-Null
    Write-Output "member.remove=ok"
  }
  catch { Write-Output "member.remove=FAIL" }
  try {
    Login $viewerPhone $pwd | Out-Null
    Write-Output "removed.login=FAIL(still works)"
  }
  catch { Write-Output "removed.login=blocked-ok" }
}
