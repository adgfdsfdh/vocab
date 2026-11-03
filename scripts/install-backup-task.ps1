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

Register-ScheduledTask -TaskName 'Vocab backup' -Description 'Ежедневный бэкап словаря в папку Google Диска' `
  -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host 'Задача «Vocab backup» установлена: ежедневно в 13:00, пропущенный запуск — после включения ПК.'
