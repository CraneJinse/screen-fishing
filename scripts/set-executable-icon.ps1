param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$Icon,
  [switch]$VerifyOnly,
  [string]$OutputDirectory,
  [string]$ProductName,
  [string]$AppVersion
)
$ErrorActionPreference = 'Stop'
$taskExe = (Resolve-Path -LiteralPath $Executable).Path
$taskIcon = (Resolve-Path -LiteralPath $Icon).Path
if ([IO.Path]::GetExtension($taskExe) -ne '.exe' -or [IO.Path]::GetExtension($taskIcon) -ne '.ico') { throw 'Expected EXE and ICO files' }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class PondExeIcon {
 public class Key { public string Name; public ushort Language; }
 delegate bool NameCallback(IntPtr h,IntPtr t,IntPtr n,IntPtr p);
 delegate bool LangCallback(IntPtr h,IntPtr t,IntPtr n,ushort l,IntPtr p);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string f,IntPtr p,uint flags);
 [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr h);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceNames(IntPtr h,IntPtr t,NameCallback c,IntPtr p);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr h,IntPtr t,IntPtr n,LangCallback c,IntPtr p);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr FindResourceEx(IntPtr h,IntPtr t,IntPtr n,ushort l);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint SizeofResource(IntPtr h,IntPtr r);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr LoadResource(IntPtr h,IntPtr r);
 [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr r);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResource(string f,bool deleteExisting);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool UpdateResource(IntPtr h,IntPtr t,IntPtr n,ushort l,byte[] data,uint size);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EndUpdateResource(IntPtr h,bool discard);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] public static extern uint ExtractIconEx(string f,int index,IntPtr[] large,IntPtr[] small,uint count);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
 static void Check(bool ok) { if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error()); }
 static IntPtr Name(string s) { return s.StartsWith("#")?new IntPtr(int.Parse(s.Substring(1))):Marshal.StringToHGlobalUni(s); }
 static void Release(string s,IntPtr p) { if(!s.StartsWith("#"))Marshal.FreeHGlobal(p); }
 static List<Key> Keys(IntPtr h,int type) {
  var list=new List<Key>();
  NameCallback callback=(a,t,n,p)=>{string name=n.ToInt64()<=65535?"#"+n.ToInt64():Marshal.PtrToStringUni(n);
   LangCallback languages=(b,u,v,l,q)=>{list.Add(new Key{Name=name,Language=l});return true;};
   Check(EnumResourceLanguages(a,t,n,languages,IntPtr.Zero));return true;};
  Check(EnumResourceNames(h,new IntPtr(type),callback,IntPtr.Zero));return list;
 }
 static byte[] Read(IntPtr h,int type,Key key) {
  IntPtr n=Name(key.Name);try{IntPtr r=FindResourceEx(h,new IntPtr(type),n,key.Language);Check(r!=IntPtr.Zero);byte[] b=new byte[SizeofResource(h,r)];Marshal.Copy(LockResource(LoadResource(h,r)),b,0,b.Length);return b;}finally{Release(key.Name,n);}
 }
 static void Write(IntPtr h,int type,Key key,byte[] bytes) {
  IntPtr n=Name(key.Name);try{Check(UpdateResource(h,new IntPtr(type),n,key.Language,bytes,(uint)(bytes==null?0:bytes.Length)));}finally{Release(key.Name,n);}
 }
 static List<byte[]> Images(byte[] ico) {
  if(ico.Length<6||BitConverter.ToUInt16(ico,0)!=0||BitConverter.ToUInt16(ico,2)!=1)throw new Exception("Invalid ICO");
  int count=BitConverter.ToUInt16(ico,4);if(count<1||count>256||ico.Length<6+16*count)throw new Exception("Invalid ICO entries");var images=new List<byte[]>();
  for(int i=0;i<count;i++){int pos=6+16*i,len=checked((int)BitConverter.ToUInt32(ico,pos+8)),start=checked((int)BitConverter.ToUInt32(ico,pos+12));if(len<1||start<6+16*count||start>ico.Length-len)throw new Exception("ICO bounds");var b=new byte[len];Array.Copy(ico,start,b,0,len);images.Add(b);}return images;
 }
 // Rebuild VERSIONINFO with its existing language tables and fixed flags intact.
 // Growing UTF-16 display names cannot safely be patched in place.
 class VersionNode { public string Key; public ushort Type; public byte[] Value; public List<VersionNode> Children=new List<VersionNode>(); }
 static int Align(int n) { return (n+3)&~3; }
 static VersionNode ReadVersion(byte[] b,int start) {
  int end=start+BitConverter.ToUInt16(b,start),count=BitConverter.ToUInt16(b,start+2),p=start+6;
  var node=new VersionNode{Type=BitConverter.ToUInt16(b,start+4)};
  int key=p;while(p+1<end&&BitConverter.ToUInt16(b,p)!=0)p+=2;
  node.Key=Encoding.Unicode.GetString(b,key,p-key);p=Align(p+2);
  int bytes=node.Type==1?count*2:count;if(p+bytes>end)throw new Exception("Invalid VERSIONINFO value");
  node.Value=b.Skip(p).Take(bytes).ToArray();p=Align(p+bytes);
  while(p+6<=end){int size=BitConverter.ToUInt16(b,p);if(size<6||p+size>end)throw new Exception("Invalid VERSIONINFO child");node.Children.Add(ReadVersion(b,p));p=Align(p+size);}return node;
 }
 static byte[] EncodeVersion(VersionNode n) {
  using(var m=new MemoryStream())using(var w=new BinaryWriter(m)){
   w.Write((ushort)0);w.Write((ushort)(n.Type==1?n.Value.Length/2:n.Value.Length));w.Write(n.Type);w.Write(Encoding.Unicode.GetBytes(n.Key+"\0"));
   while(m.Length%4!=0)w.Write((byte)0);w.Write(n.Value);
   foreach(var child in n.Children){while(m.Length%4!=0)w.Write((byte)0);w.Write(EncodeVersion(child));}
   if(m.Length>65535)throw new Exception("VERSIONINFO too large");m.Position=0;w.Write((ushort)m.Length);return m.ToArray();
  }
 }
 static void SetStrings(VersionNode n,Dictionary<string,string> values) {
  if(n.Key=="StringFileInfo")foreach(var table in n.Children)foreach(var pair in values){var item=table.Children.FirstOrDefault(x=>x.Key==pair.Key);if(item==null){item=new VersionNode{Key=pair.Key,Type=1};table.Children.Add(item);}item.Value=Encoding.Unicode.GetBytes(pair.Value+"\0");}
  foreach(var child in n.Children)SetStrings(child,values);
 }
 public static void Brand(string exe,string product,string version) {
  var v=Version.Parse(version);if(v.Major>65535||v.Minor>65535||v.Build<0||v.Build>65535)throw new Exception("Invalid application version");
  var resources=new Dictionary<Key,byte[]>();IntPtr h=LoadLibraryEx(exe,IntPtr.Zero,2);Check(h!=IntPtr.Zero);
  try{foreach(var key in Keys(h,16)){var n=ReadVersion(Read(h,16,key),0);if(n.Key!="VS_VERSION_INFO"||n.Value.Length<52)throw new Exception("Invalid fixed version info");
   uint hi=((uint)v.Major<<16)|(uint)v.Minor,lo=(uint)v.Build<<16;
   foreach(int offset in new[]{8,16}){Array.Copy(BitConverter.GetBytes(hi),0,n.Value,offset,4);Array.Copy(BitConverter.GetBytes(lo),0,n.Value,offset+4,4);}
   SetStrings(n,new Dictionary<string,string>{{"ProductName",product},{"FileDescription",product},{"InternalName","ScreenFishing"},{"OriginalFilename","ScreenFishing.exe"},{"FileVersion",version},{"ProductVersion",version},{"CompanyName","Screen Fishing contributors"}});resources.Add(key,EncodeVersion(n));
  }}finally{FreeLibrary(h);}
  h=BeginUpdateResource(exe,false);Check(h!=IntPtr.Zero);bool done=false;
  try{foreach(var item in resources)Write(h,16,item.Key,item.Value);Check(EndUpdateResource(h,false));done=true;}finally{if(!done)EndUpdateResource(h,true);}
 }
 public static int Process(string exe,string icon,bool verifyOnly) {
  byte[] ico=File.ReadAllBytes(icon);var images=Images(ico);List<Key> groups,oldIcons;IntPtr module=LoadLibraryEx(exe,IntPtr.Zero,2);Check(module!=IntPtr.Zero);
  try{groups=Keys(module,14);oldIcons=Keys(module,3);}finally{FreeLibrary(module);}
  if(groups.Count==0)throw new Exception("EXE has no icon groups");
  if(!verifyOnly){
   byte[] group=new byte[6+14*images.Count];Array.Copy(ico,0,group,0,6);
   for(int i=0;i<images.Count;i++){Array.Copy(ico,6+16*i,group,6+14*i,12);Array.Copy(BitConverter.GetBytes((ushort)(i+1)),0,group,6+14*i+12,2);}
   IntPtr update=BeginUpdateResource(exe,false);Check(update!=IntPtr.Zero);bool done=false;
   try{foreach(var old in oldIcons)Write(update,3,old,null);foreach(ushort lang in groups.Select(x=>x.Language).Distinct())for(int i=0;i<images.Count;i++)Write(update,3,new Key{Name="#"+(i+1),Language=lang},images[i]);foreach(var g in groups)Write(update,14,g,group);Check(EndUpdateResource(update,false));done=true;}finally{if(!done)EndUpdateResource(update,true);}
  }
  module=LoadLibraryEx(exe,IntPtr.Zero,2);Check(module!=IntPtr.Zero);
  try{foreach(var key in Keys(module,14)){byte[] group=Read(module,14,key);if(BitConverter.ToUInt16(group,4)!=images.Count)throw new Exception("Icon count mismatch");for(int i=0;i<images.Count;i++){int p=6+14*i,id=BitConverter.ToUInt16(group,p+12);if(!group.Skip(p).Take(12).SequenceEqual(ico.Skip(6+16*i).Take(12)))throw new Exception("Group metadata mismatch");if(!Read(module,3,new Key{Name="#"+id,Language=key.Language}).SequenceEqual(images[i]))throw new Exception("Embedded icon differs from ICO");}}}finally{FreeLibrary(module);}return groups.Count;
 }
}
'@
if ($ProductName) {
  if (-not $AppVersion) { throw 'AppVersion is required with ProductName' }
  if (-not $VerifyOnly) { [PondExeIcon].GetMethod('Brand').Invoke($null, @($taskExe,$ProductName,$AppVersion)) }
  $taskVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($taskExe)
  if ($taskVersion.ProductName -ne $ProductName -or $taskVersion.FileDescription -ne $ProductName -or $taskVersion.ProductVersion -ne $AppVersion) { throw 'Executable product metadata mismatch' }
}
$taskGroups = [PondExeIcon].GetMethod('Process').Invoke($null, @($taskExe,$taskIcon,[bool]$VerifyOnly.IsPresent))
$taskPreviews = @()
if ($OutputDirectory) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($OutputDirectory)) | Out-Null
  Add-Type -AssemblyName System.Drawing
  $taskLarge = New-Object IntPtr[] 1
  $taskSmall = New-Object IntPtr[] 1
  if ([PondExeIcon]::ExtractIconEx($taskExe,0,$taskLarge,$taskSmall,1) -eq 0) { throw 'Shell icon extraction failed' }
  foreach ($taskKind in @('small','large')) {
    $taskHandle = if ($taskKind -eq 'small') { $taskSmall[0] } else { $taskLarge[0] }
    $taskBitmap = [Drawing.Icon]::FromHandle($taskHandle).ToBitmap()
    $taskFile = Join-Path $OutputDirectory ('exe-icon-'+$taskKind+'.png')
    $taskBitmap.Save($taskFile,[Drawing.Imaging.ImageFormat]::Png)
    $taskPreviews += @{kind=$taskKind;width=$taskBitmap.Width;height=$taskBitmap.Height}
    $taskBitmap.Dispose()
    [PondExeIcon]::DestroyIcon($taskHandle) | Out-Null
  }
}
@{ok=$true;groups=$taskGroups;allEmbeddedImagesMatch=$true;verifyOnly=$VerifyOnly.IsPresent;previews=$taskPreviews} | ConvertTo-Json -Depth 4 -Compress
