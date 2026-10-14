$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$destination = Join-Path $PSScriptRoot '../assets'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$bitmap = [Drawing.Bitmap]::new(256, 256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#0B0B0C'))
$pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml('#D4AF37'), 18)
$pen.StartCap = [Drawing.Drawing2D.LineCap]::Square
$pen.EndCap = [Drawing.Drawing2D.LineCap]::Square
$points = [Drawing.PointF[]]@(
  [Drawing.PointF]::new(42, 70), [Drawing.PointF]::new(79, 184),
  [Drawing.PointF]::new(128, 106), [Drawing.PointF]::new(174, 184),
  [Drawing.PointF]::new(214, 70)
)
$graphics.DrawLines($pen, $points)
$memory = [IO.MemoryStream]::new()
$bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
$png = $memory.ToArray()
[IO.File]::WriteAllBytes((Join-Path $destination 'icon.png'), $png)
$icon = [IO.File]::Create((Join-Path $destination 'icon.ico'))
$writer = [IO.BinaryWriter]::new($icon)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
$writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png)
$writer.Dispose(); $memory.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $pen.Dispose()
