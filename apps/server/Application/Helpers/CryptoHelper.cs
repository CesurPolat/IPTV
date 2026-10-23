using System.Security.Cryptography;
using System.Text;

namespace Application.Helpers
{
    public static class CryptoHelper
    {
        /**
         * Decrypts the given ciphertext using PBKDF2 and AES.
         * @param ciphertext - The encrypted data (Base64 string).
         * @param ivory - The IV in Hex format.
         * @param saltHex - The salt in Hex format.
         * @param password - The password string for PBKDF2.
         * @returns - The decrypted UTF-8 string.
         */
        public static string? DecryptData(string ciphertext, string ivory, string saltHex, string password)
        {
            try
            {
                byte[] salt = HexToByteArray(saltHex);
                byte[] iv = HexToByteArray(ivory);
                byte[] cipherBytes = Convert.FromBase64String(ciphertext);

                // PBKDF2
                using (var pbkdf2 = new Rfc2898DeriveBytes(password, salt, 999, HashAlgorithmName.SHA512))
                {
                    byte[] key = pbkdf2.GetBytes(32); // 256 bit (8 words * 4 bytes/word)

                    // AES Decrypt
                    using (Aes aes = Aes.Create())
                    {
                        aes.Key = key;
                        aes.IV = iv;
                        aes.Mode = CipherMode.CBC; // CryptoJS default
                        aes.Padding = PaddingMode.PKCS7; // CryptoJS default

                        using (ICryptoTransform decryptor = aes.CreateDecryptor(aes.Key, aes.IV))
                        {
                            byte[] decryptedBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);
                            return Encoding.UTF8.GetString(decryptedBytes);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Decryption failed: {ex.Message}");
                return null;
            }
        }

        private static byte[] HexToByteArray(string hex)
        {
            int numberChars = hex.Length;
            byte[] bytes = new byte[numberChars / 2];
            for (int i = 0; i < numberChars; i += 2)
            {
                bytes[i / 2] = Convert.ToByte(hex.Substring(i, 2), 16);
            }
            return bytes;
        }
    }
}
