import { Routes } from '@angular/router';
import { TvComponent } from './pages/tv/tv.component';
import { HomeComponent } from './pages/home/home.component';

export const routes: Routes = [
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
        path: 'tv/:id',
        component: TvComponent
    }
];
