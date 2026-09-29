# Long-running helper: streams Windows media sessions (SMTC) as JSON lines on stdout
# and accepts commands on stdin:  toggle|<appId>  next|<appId>  prev|<appId>  seek|<appId>|<ms>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation')
})[0]
function Await($op, $type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    [void]$t.Wait(-1)
    $t.Result
}

# Read stdin on a background runspace so the main loop never blocks
$queue = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$rs = [runspacefactory]::CreateRunspace(); $rs.Open()
$rs.SessionStateProxy.SetVariable('queue', $queue)
$reader = [powershell]::Create(); $reader.Runspace = $rs
[void]$reader.AddScript({ while ($null -ne ($l = [Console]::In.ReadLine())) { $queue.Enqueue($l) } })
[void]$reader.BeginInvoke()

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$thumbKeys = @{}

# WinRT streams arrive as opaque COM objects PowerShell can't cast, so bridge to a .NET stream by reflection
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IInputStream'
} | Select-Object -First 1

function Get-Thumb($props) {
    if ($null -eq $props.Thumbnail) { return $null }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $net = $asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $mime = if ($stream.ContentType) { $stream.ContentType } else { 'image/jpeg' }
    $net.Dispose()
    if ($ms.Length -eq 0) { return $null }
    "data:$mime;base64," + [Convert]::ToBase64String($ms.ToArray())
}

function Run-Command($line) {
    $p = $line.Split('|')
    $s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $p[1] } | Select-Object -First 1
    if ($null -eq $s) { return }
    switch ($p[0]) {
        'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
        'next'   { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
        'prev'   { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
        'seek'   { [void](Await ($s.TryChangePlaybackPositionAsync([long]([double]$p[2] * 10000))) ([bool])) }
    }
}

while ($true) {
    $line = $null
    while ($queue.TryDequeue([ref]$line)) { try { Run-Command $line } catch { } }

    $out = @()
    foreach ($s in $mgr.GetSessions()) {
        try {
            $id = $s.SourceAppUserModelId
            $info = $s.GetPlaybackInfo()
            $tl = $s.GetTimelineProperties()
            $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $playing = ([int]$info.PlaybackStatus -eq 4)
            $dur = ($tl.EndTime - $tl.StartTime).TotalMilliseconds
            $pos = ($tl.Position - $tl.StartTime).TotalMilliseconds
            if ($playing) {
                $delta = ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds
                if ($delta -gt 0 -and $delta -lt 3600000) { $pos += $delta }
            }
            if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
            $key = "$($props.Title)|$($props.Artist)|$($props.AlbumTitle)"
            $item = [ordered]@{
                id = $id; playing = $playing; title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle
                posMs = [math]::Round($pos); durMs = [math]::Round($dur)
                canToggle = [bool]$info.Controls.IsPlayPauseToggleEnabled
                canNext = [bool]$info.Controls.IsNextEnabled; canPrev = [bool]$info.Controls.IsPreviousEnabled
                canSeek = [bool]$info.Controls.IsPlaybackPositionEnabled
                key = $key
            }
            # Send artwork only once per track (retry until the app has produced it)
            if ($thumbKeys[$id] -ne $key) {
                $thumb = $null
                try { $thumb = Get-Thumb $props } catch { }
                if ($thumb) { $item.thumb = $thumb; $thumbKeys[$id] = $key }
            }
            $out += $item
        } catch { }
    }
    $json = ConvertTo-Json -InputObject ([ordered]@{ sessions = @($out) }) -Compress -Depth 4
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 400
}
