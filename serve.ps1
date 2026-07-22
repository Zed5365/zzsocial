# Serves the ZZSocial frontend at http://localhost:8777
# Blocks the server/ folder and dotfiles so secrets are never exposed.
param(
  [string]$Root = "C:\Projects\ZZSocial",
  [int]$Port = 8777
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "ZZSocial frontend at http://localhost:$Port/  (Ctrl+C to stop)"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $req = $ctx.Request
  $res = $ctx.Response
  try {
    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = "index.html" }

    # Block server code, secrets, and path traversal.
    $blocked = ($rel -match '(^|[\\/])server([\\/]|$)') -or ($rel -match '(^|[\\/])\.') -or ($rel -match '\.\.')
    $path = Join-Path $Root $rel

    if ($blocked -or -not (Test-Path $path -PathType Leaf)) {
      $res.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("Not found")
      $res.OutputStream.Write($msg, 0, $msg.Length)
    } else {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
      $res.StatusCode = 200
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.OutputStream.Close()
  }
}
