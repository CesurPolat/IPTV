import { Routes } from '@angular/router';
import { TvComponent } from './pages/tv/tv.component';
import { HomeComponent } from './pages/home/home.component';
import { PlayerComponent } from './pages/player/player.component';
import { SearchComponent } from './pages/search/search.component';
import { SeriesComponent } from './pages/series/series.component';
import { MainLayoutComponent } from './components/layout/main-layout.component';
import { RadioComponent } from './pages/radio/radio.component';
import { SettingsComponent } from './pages/settings/settings.component';

export const routes: Routes = [
    {
        path: '',
        component: MainLayoutComponent,
        children: [
            {
                path: '',
                redirectTo: 'home',
                pathMatch: 'full'
            },
            {
                path: 'home',
                component: HomeComponent
            },
            {
                path: 'search',
                component: SearchComponent
            },
            {
                path: 'series',
                component: SeriesComponent
            },
            {
                path: 'settings',
                component: SettingsComponent
            }
        ]
    },
    {
        path: 'tv/:id',
        component: TvComponent
    },
    {
        path: 'player',
        component: PlayerComponent
    },
    {
        path: 'radio',
        component: RadioComponent
    }
];
