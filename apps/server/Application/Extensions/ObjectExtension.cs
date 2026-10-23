
using System.Text.Json;

namespace Application.Extensions
{
    public static class ObjectExtension
    {
        public static bool IsDefault(this object obj)
        {
            if (obj == null)
                return true;

            var properties = obj.GetType().GetProperties();

            foreach (var property in properties)
            {
                // Skip properties with nullability annotations if nullable reference types are enabled
                if (property.PropertyType.IsValueType)
                {
                    var value = property.GetValue(obj);
                    // For value types, check if it is the default value
                    if (!Equals(value, Activator.CreateInstance(property.PropertyType)))
                        return false;
                }
                else
                {
                    // For reference types, check if they are null
                    var value = property.GetValue(obj);
                    if (value != null)
                        return false;
                }
            }

            return true;
        }

        public static T DeepCopy<T>(this T source)
        {
            var json = JsonSerializer.Serialize(source);
            return JsonSerializer.Deserialize<T>(json);
        }

    }
}
