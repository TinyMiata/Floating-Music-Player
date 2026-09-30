# Long-running helper: captures the audio of specific apps (WASAPI process loopback, so other apps' sound is ignored)
# and streams a spectrum as lines on stdout:  S <base64 of 128 bytes>   (same scaling as a Web Audio AnalyserNode, fftSize 256)
# Usage: audiotap.ps1 -Names "Spotify.exe"   (comma separated; each app's whole process tree is captured)
param([string]$Names)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

public static class Tap
{
    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceCompletionHandler { void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op); }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint flags, long hnsBuffer, long hnsPeriod, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint n);
        [PreserveSig] int GetStreamLatency(out long l);
        [PreserveSig] int GetCurrentPadding(out uint p);
        [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long def, out long min);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr h);
        [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object svc);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devPos, out ulong qpc);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint n);
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    static extern void ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string path,
        [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        IntPtr activationParams,
        IActivateAudioInterfaceCompletionHandler handler,
        out IActivateAudioInterfaceAsyncOperation op);

    [DllImport("kernel32.dll")] static extern IntPtr CreateEvent(IntPtr attrs, bool manual, bool initial, string name);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    public class Handler : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public ManualResetEvent Done = new ManualResetEvent(false);
        public int Hr;
        public object Client;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            op.GetActivateResult(out Hr, out Client);
            Done.Set();
        }
    }

    const int RING = 4096;

    public class Capture
    {
        public int Pid;
        public float[] Ring = new float[RING];
        public long Written;
        public long LastTicks;
        public volatile bool Stop;
        public Thread Thread;

        public void Run()
        {
            IntPtr pv = IntPtr.Zero, blob = IntPtr.Zero, fmt = IntPtr.Zero, evt = IntPtr.Zero;
            try
            {
                // PROPVARIANT (VT_BLOB) holding AUDIOCLIENT_ACTIVATION_PARAMS { PROCESS_LOOPBACK, pid, INCLUDE_TARGET_PROCESS_TREE }
                blob = Marshal.AllocHGlobal(12);
                Marshal.WriteInt32(blob, 0, 1);
                Marshal.WriteInt32(blob, 4, Pid);
                Marshal.WriteInt32(blob, 8, 0);
                pv = Marshal.AllocHGlobal(24);
                for (int i = 0; i < 24; i += 8) Marshal.WriteInt64(pv, i, 0);
                Marshal.WriteInt16(pv, 0, 65);
                Marshal.WriteInt32(pv, 8, 12);
                Marshal.WriteIntPtr(pv, 16, blob);

                var h = new Handler();
                IActivateAudioInterfaceAsyncOperation op;
                ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, pv, h, out op);
                if (!h.Done.WaitOne(5000) || h.Hr != 0 || h.Client == null) return;
                var client = (IAudioClient)h.Client;

                // 32-bit float, stereo, 48 kHz (process loopback has no mix format of its own)
                fmt = Marshal.AllocHGlobal(18);
                Marshal.WriteInt16(fmt, 0, 3);
                Marshal.WriteInt16(fmt, 2, 2);
                Marshal.WriteInt32(fmt, 4, 48000);
                Marshal.WriteInt32(fmt, 8, 48000 * 8);
                Marshal.WriteInt16(fmt, 12, 8);
                Marshal.WriteInt16(fmt, 14, 32);
                Marshal.WriteInt16(fmt, 16, 0);
                // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY
                if (client.Initialize(0, 0x00020000u | 0x00040000u | 0x80000000u | 0x08000000u, 200000, 0, fmt, IntPtr.Zero) != 0) return;
                evt = CreateEvent(IntPtr.Zero, false, false, null);
                client.SetEventHandle(evt);
                Guid capId = typeof(IAudioCaptureClient).GUID;
                object svc;
                if (client.GetService(ref capId, out svc) != 0) return;
                var cap = (IAudioCaptureClient)svc;
                client.Start();

                while (!Stop)
                {
                    WaitForSingleObject(evt, 100);
                    uint n;
                    while (cap.GetNextPacketSize(out n) == 0 && n > 0)
                    {
                        IntPtr data; uint frames, flags; ulong dp, qpc;
                        if (cap.GetBuffer(out data, out frames, out flags, out dp, out qpc) != 0) break;
                        bool silent = (flags & 2) != 0;
                        float[] tmp = new float[frames * 2];
                        if (!silent) Marshal.Copy(data, tmp, 0, (int)(frames * 2));
                        cap.ReleaseBuffer(frames);
                        lock (this)
                        {
                            for (int i = 0; i < frames; i++)
                            {
                                Ring[Written % RING] = (tmp[i * 2] + tmp[i * 2 + 1]) * 0.5f;
                                Written++;
                            }
                            LastTicks = Environment.TickCount;
                        }
                    }
                }
                client.Stop();
            }
            catch (Exception) { }
            finally
            {
                if (evt != IntPtr.Zero) CloseHandle(evt);
                if (fmt != IntPtr.Zero) Marshal.FreeHGlobal(fmt);
                if (pv != IntPtr.Zero) Marshal.FreeHGlobal(pv);
                if (blob != IntPtr.Zero) Marshal.FreeHGlobal(blob);
            }
        }

        /** Copies the latest n samples (zeros while nothing has been captured recently) */
        public void Latest(float[] dst, int n)
        {
            lock (this)
            {
                if (Written < n || Environment.TickCount - LastTicks > 150) return;
                for (int i = 0; i < n; i++) dst[i] += Ring[(Written - n + i) % RING];
            }
        }
    }

    static readonly Dictionary<int, Capture> captures = new Dictionary<int, Capture>();
    static readonly object gate = new object();

    public static void SetPids(int[] pids)
    {
        lock (gate)
        {
            var want = new HashSet<int>(pids);
            foreach (var pid in new List<int>(captures.Keys))
                if (!want.Contains(pid)) { captures[pid].Stop = true; captures.Remove(pid); }
            foreach (int pid in pids)
                if (!captures.ContainsKey(pid))
                {
                    var c = new Capture { Pid = pid };
                    c.Thread = new Thread(c.Run) { IsBackground = true };
                    c.Thread.Start();
                    captures[pid] = c;
                }
        }
    }

    const int N = 256;

    static void Fft(double[] re, double[] im)
    {
        int n = re.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            int bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (int len = 2; len <= n; len <<= 1)
        {
            double ang = -2 * Math.PI / len;
            double wr = Math.Cos(ang), wi = Math.Sin(ang);
            for (int i = 0; i < n; i += len)
            {
                double cr = 1, ci = 0;
                for (int k = 0; k < len / 2; k++)
                {
                    int a = i + k, b = i + k + len / 2;
                    double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                    double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                }
            }
        }
    }

    /** Emits a spectrum ~60 times a second, and exits when the parent closes our stdin */
    public static void RunLoop()
    {
        var t = new Thread(() => { while (Console.In.Read() >= 0) { } Environment.Exit(0); }) { IsBackground = true };
        t.Start();
        var win = new double[N];
        for (int i = 0; i < N; i++)
        {
            double a = 0.16, x = (double)i / N;
            win[i] = (1 - a) / 2 - 0.5 * Math.Cos(2 * Math.PI * x) + a / 2 * Math.Cos(4 * Math.PI * x);
        }
        var smooth = new double[N / 2];
        var mix = new float[N];
        var re = new double[N];
        var im = new double[N];
        var bytes = new byte[N / 2];
        var stdout = Console.Out;
        while (true)
        {
            Thread.Sleep(16);
            Array.Clear(mix, 0, N);
            lock (gate) foreach (var c in captures.Values) c.Latest(mix, N);
            for (int i = 0; i < N; i++) { re[i] = mix[i] * win[i]; im[i] = 0; }
            Fft(re, im);
            for (int k = 0; k < N / 2; k++)
            {
                double mag = Math.Sqrt(re[k] * re[k] + im[k] * im[k]) / N;
                smooth[k] = 0.75 * smooth[k] + 0.25 * mag;
                double db = smooth[k] > 1e-12 ? 20 * Math.Log10(smooth[k]) : -200;
                double v = (db + 100) / 70 * 255;
                bytes[k] = (byte)Math.Max(0, Math.Min(255, v));
            }
            stdout.WriteLine("S " + Convert.ToBase64String(bytes));
            stdout.Flush();
        }
    }
}
'@

$wanted = @($Names -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })

# The audio tree hangs off the root process (browsers and Electron apps spawn many children that share one name)
function Get-Roots {
    $roots = @()
    foreach ($n in $wanted) {
        $procs = @(Get-CimInstance Win32_Process -Filter "Name='$($n -replace "'", "''")'" -ErrorAction SilentlyContinue)
        $ids = @($procs | ForEach-Object { $_.ProcessId })
        $roots += @($procs | Where-Object { $ids -notcontains $_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
    }
    $roots
}

$loop = [powershell]::Create()
[void]$loop.AddScript({ [Tap]::RunLoop() })
[void]$loop.BeginInvoke()

$last = $null
while ($true) {
    $roots = @(Get-Roots)
    $key = ($roots | Sort-Object) -join ','
    if ($key -ne $last) {
        [Tap]::SetPids([int[]]$roots)
        $last = $key
    }
    Start-Sleep -Seconds 2
}
