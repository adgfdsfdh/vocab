# Ставит задачу «Vocab backup» в Планировщик заданий Windows: каждый день в 13:00 запускает
# node scripts/backup.mjs. Если ПК в это время был выключен — задача выполнится вскоре после включения.
# Запуск (повторный запуск просто обновит задачу):
#   powershell -ExecutionPolicy Bypass -File scripts\install-backup-task.ps1
# Удалить задачу: Unregister-ScheduledTask -TaskName "Vocab backup" -Confirm:$false

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$script = Join-Path $root 'scripts\backup.mjs'

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At 13:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Надписи латиницей: Windows PowerShell 5.1 читает файл без BOM не как UTF-8.
Register-ScheduledTask -TaskName 'Vocab backup' -Description 'Daily vocab backup to Google Drive folder' `
  -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host 'OK: task "Vocab backup" installed (daily 13:00; missed run starts after the PC is turned on).'
