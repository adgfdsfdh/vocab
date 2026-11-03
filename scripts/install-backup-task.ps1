# Ставит задачу «Vocab backup» в Планировщик заданий Windows: при каждом входе в Windows (через минуту,
# чтобы успела появиться сеть) запускает node scripts/backup.mjs. Сам скрипт делает копию не чаще раза в сутки.
# Запуск (повторный запуск просто обновит задачу):
#   powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1
# Удалить задачу: Unregister-ScheduledTask -TaskName "Vocab backup" -Confirm:$false

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$script = Join-Path $root 'scripts\backup.mjs'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$trigger.Delay = 'PT1M'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Надписи латиницей: Windows PowerShell 5.1 читает файл без BOM не как UTF-8.
Register-ScheduledTask -TaskName 'Vocab backup' -Description 'Vocab backup at logon, at most once a day' `
  -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host 'OK: task "Vocab backup" installed (at logon, at most once a day).'
