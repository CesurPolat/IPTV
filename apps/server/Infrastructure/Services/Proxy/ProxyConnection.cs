
using System.Net;

namespace Infrastructure.Services.Proxy
{
    public static class ProxyConnection
    {

        public static void GetProxy(this HttpClientHandler httpClientHandler)
        {
            httpClientHandler.Proxy = new WebProxy("http://31.210.36.3:3128")
            {
                Credentials = new NetworkCredential("cesurpolat", "newiptvPass")
            };
        }

    }
}
