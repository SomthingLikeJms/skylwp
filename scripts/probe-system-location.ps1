$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
$null=[Windows.Devices.Geolocation.Geoposition,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
$locator=New-Object Windows.Devices.Geolocation.Geolocator
$locator.DesiredAccuracyInMeters=[uint32]10000
try {
    $operation=$locator.GetGeopositionAsync([TimeSpan]::FromMinutes(30),[TimeSpan]::FromSeconds(12))
    $asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1} | Select-Object -First 1
    $task=$asTask.MakeGenericMethod([Windows.Devices.Geolocation.Geoposition]).Invoke($null,@($operation))
    if(!$task.Wait(14000)){throw 'Windows location timed out'}
    $position=$task.Result
    $city=''
    try{$city=$position.CivicAddress.City}catch{}
    [pscustomobject]@{Available=$true;City=$city;AccuracyMeters=$position.Coordinate.Accuracy;Source=$position.Coordinate.PositionSource.ToString()} | ConvertTo-Json -Compress
} catch {
    [pscustomobject]@{Available=$false;Status=$locator.LocationStatus.ToString();Error=$_.Exception.Message} | ConvertTo-Json -Compress
}
