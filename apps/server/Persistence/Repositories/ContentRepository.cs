using Application.Repositories;
using Domain.Entities;
using MongoDB.Driver;
using MongoDB.Driver.Linq;

namespace Persistence.Repositories
{
    public class ContentRepository : IContentRepository
    {

        public ContentRepository()
        {
        }

        public Task<List<Content>> GetAllContentAsync()
        {
            return Task.FromResult(new List<Content>()
            {
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "TRT 1",
                        ChannelId = "trt-1-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/TRT_1_logo_%282021-%29.svg/1920px-TRT_1_logo_%282021-%29.svg.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://trt.daioncdn.net/trt-1/master.m3u8?app=web" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "^((?!_primary).)*$",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "ATV",
                        ChannelId = "atv-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Atv_logo_2010.svg/1280px-Atv_logo_2010.svg.png",
                        Source = new { 
                            ScriptableType = ScriptableClassType.API, 
                            IsProxyChannelEnabled = true,
                            Url = "https://securevideotoken.tmgrup.com.tr/webtv/secure?url=https%3A%2F%2Ftrkvz.daioncdn.net%2Fatv%2Fatv.m3u8%3Fce%3D3%26app%3Dd1ce2d40-5256-4550-b02e-e73c185a314e",
                            RequestType = RequestType.GET,
                            Headers = new Dictionary<string, string>
                            {
                                { "Referer", "https://www.atv.com.tr/" }
                            },
                            SelectPropertyClass = new SelectPropertyClass
                            {
                                Type = PropertyType.String,
                                PropertyName = "Url"
                            }
                        },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "Kanal D",
                        ChannelId = "kanal-d-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/tr/4/4e/Kanal_D.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://demiroren.daioncdn.net/kanald/kanald.m3u8?app=kanald_web&ce=3&ppid=90c3164ba032ec3d41ffbcd67477566c" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "Star TV",
                        ChannelId = "star-tv-yayin-akisi",
                        Poster = "https://img-puhutv.mncdn.com/media/img/content/26-02/18/startv_logo_2025-1771392478.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://dogus.daioncdn.net/startv/startv.m3u8?ce=3&app=a20ac41e-bdc3-4aa1-934d-26b484480ac9" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "NOW TV",
                        ChannelId = "now-tv-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/NOW_TV_%28Turkey%29_wordmark-red.svg/1920px-NOW_TV_%28Turkey%29_wordmark-red.svg.png",
                        Source = new { 
                            ScriptableType = ScriptableClassType.HTML, 
                            Url = "https://www.nowtv.com.tr/canli-yayin",
                            SplitableClasses = new List<SplitableClass>
                            {
                                new SplitableClass
                                {
                                    Separator = "daionUrl :   (mobilecheck() == true ? '",
                                    Index = 1
                                },
                                new SplitableClass
                                {
                                    Separator = "'",
                                    Index = 0
                                }
                            }
                        },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "TV360",
                        ChannelId = "tv360-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/tr/thumb/7/78/Skyturk360_logosu.png/120px-Skyturk360_logosu.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://turkmedya-live.ercdn.net/tv360/tv360.m3u8" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "Kanal 7",
                        ChannelId = "kanal-7-yayin-akisi",
                        Poster = "https://cdn.kanal7.com/kanal7/wp-content/themes/kanal7/v2/images/kanal7-logo.svg",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://kanal7.daioncdn.net/kanal7/kanal7.m3u8?app=f99587ad-1637-494d-8255-da35b09d17a1&ce=3" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "Show TV",
                        ChannelId = "show-tv-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Show_TV_logo.svg/960px-Show_TV_logo.svg.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://ciner.daioncdn.net/showtv/showtv.m3u8?ce=3&app=4bc856ef-4c68-4a94-bc87-37dfaaa66558" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "A2 TV",
                        ChannelId = "a2-tv-yayin-akisi",
                        Poster = "https://iatv.tmgrup.com.tr/site/v2/a2tv/i/a2tv-logo.png",
                        Source = new { 
                            ScriptableType = ScriptableClassType.API, 
                            IsProxyChannelEnabled = true,
                            Url = "https://securevideotoken.tmgrup.com.tr/webtv/secure?url=https%3A%2F%2Ftrkvz.daioncdn.net%2Fa2tv%2Fa2tv.m3u8%3Fce%3D3%26app%3D59363a60-be96-4f73-9eff-355d0ff2c758",
                            RequestType = RequestType.GET,
                            Headers = new Dictionary<string, string>
                            {
                                { "Referer", "https://www.atv.com.tr/" }
                            },
                            SelectPropertyClass = new SelectPropertyClass
                            {
                                Type = PropertyType.String,
                                PropertyName = "Url"
                            }
                        },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "TV8",
                        ChannelId = "tv8-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/tr/6/68/Tv8_Yeni_Logo.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://tv8.daioncdn.net/tv8/tv8.m3u8?app=7ddc255a-ef47-4e81-ab14-c0e5f2949788&ce=3" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "TV2",
                        ChannelId = "tv2-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/tr/a/ae/Tv2_logo_%282026%29.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://demiroren.daioncdn.net/teve2/teve2.m3u8?ce=3&app=6aab838a-437e-4a1b-bbd0-e30f79cdbbbd" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "Habertürk TV",
                        ChannelId = "haberturk-tv-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Habert%C3%BCrk_TV_logo.svg/1920px-Habert%C3%BCrk_TV_logo.svg.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://ciner.daioncdn.net/haberturktv/haberturktv.m3u8?app=c98ab0b0-50cc-495b-bb37-778e91f5ff5b&ce=3" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "TLC",
                        ChannelId = "tlc-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/TLC_logo_%282023%29.svg/1920px-TLC_logo_%282023%29.svg.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://dogus.daioncdn.net/tlc/tlc.m3u8?ce=3&app=1aca0aa1-06e3-41ff-a8e5-38d7df475469" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    },
                    new Content {
                        Id = MongoDB.Bson.ObjectId.GenerateNewId(),
                        Name = "DMAX",
                        ChannelId = "dmax-yayin-akisi",
                        Poster = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/DMAX_BLACK.svg/1920px-DMAX_BLACK.svg.png",
                        Source = new { ScriptableType = ScriptableClassType.Value, Value = "https://dogus.daioncdn.net/dmax/dmax.m3u8?ce=3&app=5a02c599-d17e-4982-9b04-090934d51af7" },
                        Category = Domain.Enums.Category.TVChannel,
                        AdsRegex = "p_",
                    }
            });
        }
    }
}
