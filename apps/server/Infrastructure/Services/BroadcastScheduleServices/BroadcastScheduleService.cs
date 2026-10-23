
using AngleSharp;
using Application.Abstractions;
using Domain.Entities;

namespace Infrastructure.Services.BroadcastScheduleServices
{
    public class BroadcastScheduleService : IBroadcastScheduleService
    {
        private readonly string todayScheduleUrl = "https://www.tvyayinakisi.com/tvde-bugun-rehberi/";


        public async Task<List<string>> GetTodaysSchedule()
        {
            var config = Configuration.Default.WithDefaultLoader();
            var context = BrowsingContext.New(config);
            var document = await context.OpenAsync(todayScheduleUrl);

            Dictionary<string, List<string>> channelSchedule = new Dictionary<string, List<string>>();

            var schedule = document.QuerySelectorAll(".channels-today__program").ToList();

            //var channelSchedule = schedule

            return [];

        }

        public async Task<List<BroadcastSchedule>> GetCurrentSchedule()
        {
            var config = Configuration.Default.WithDefaultLoader();
            var context = BrowsingContext.New(config);
            var document = await context.OpenAsync(todayScheduleUrl);

            var schedule = document.QuerySelectorAll(".channels-today__program__item.channels-today__program__item--active > .inner")
                .Select(x => new BroadcastSchedule
                {
                    // 1. Map 'data-channel-slug' to 'ChannelId'
                    // The parent of 'x' is the 'channels-today__program__item--active' element,
                    // and its parent is the element that holds 'data-channel-slug'.
                    ChannelId = x.ParentElement.ParentElement.GetAttribute("data-channel-slug"),

                    // 2. Map the extracted title to 'ShowTitle'
                    ShowTitle = x.QuerySelector(".channels-today__program__title").TextContent,

                    // 3. Map the extracted time to 'ShowTime'
                    ShowTime = x.QuerySelector(".channels-today__program__time").TextContent,
                    // 4. Set 'Date' to today's date in "dd.MM.yyyy" format
                    Date = DateTime.Now.ToString("dd.MM.yyyy")
                })
                .ToList();

            return schedule;
        }

    }
}
