param([Parameter(Mandatory=$true)][string]$WindowHandle,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PondIconReader {
 [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
$taskHandle=[IntPtr]::new([long]::Parse($WindowHandle))
$results=@()
foreach($kind in @(0,1)) {
  $iconHandle=[PondIconReader]::SendMessage($taskHandle,0x007F,[IntPtr]::new($kind),[IntPtr]::Zero)
  if($iconHandle -eq [IntPtr]::Zero){throw "Window icon $kind is missing"}
  $icon=[System.Drawing.Icon]::FromHandle($iconHandle)
  $bitmap=$icon.ToBitmap()
  $red=0; $white=0; $visible=0
  for($y=0;$y -lt $bitmap.Height;$y++){for($x=0;$x -lt $bitmap.Width;$x++){
    $color=$bitmap.GetPixel($x,$y)
    if($color.A -gt 100){$visible++;if($color.R -gt 130 -and $color.R -gt ($color.G*1.4) -and $color.R -gt ($color.B*1.4)){$red++};if($color.R -gt 175 -and $color.G -gt 175 -and $color.B -gt 175){$white++}}
  }}
  if($red -eq 0 -or $white -eq 0){throw "Window icon $kind does not contain the koi red-white pattern"}
  $bitmap.Save((Join-Path $OutputDirectory "window-icon-$kind.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  $results+=@{kind=$kind;width=$bitmap.Width;height=$bitmap.Height;visible=$visible;red=$red;white=$white}
  $bitmap.Dispose();$icon.Dispose()
}
$results | ConvertTo-Json -Compress
