// Byte-preserving SSH ProxyCommand for WSL hosts whose VPN blocks guest routes.
// The SSH client, authentication and host-key verification remain inside WSL.
using System;
using System.Net.Sockets;
using System.Threading.Tasks;

class WindowsTcpRelay
{
    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2) throw new ArgumentException("Expected host and port");
            using (var client = new TcpClient())
            {
                var connect = client.ConnectAsync(args[0], int.Parse(args[1]));
                if (!connect.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("TCP connection timed out");
                connect.GetAwaiter().GetResult();
                using (var stream = client.GetStream())
                {
                    Task input = Console.OpenStandardInput().CopyToAsync(stream);
                    stream.CopyToAsync(Console.OpenStandardOutput()).GetAwaiter().GetResult();
                    GC.KeepAlive(input);
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
